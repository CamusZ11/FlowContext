use super::hot_zone::{Action, HotZoneEngine, MonitorRect, Point, Rect, WindowState};
use super::runtime::{report_runtime_result, RuntimePort, RuntimeSample, SamplingRuntime};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct FakePort {
    samples: Vec<RuntimeSample>,
    actions: Arc<Mutex<Vec<Action>>>,
}

impl RuntimePort for FakePort {
    fn sample(&mut self) -> Result<RuntimeSample, String> {
        self.samples
            .first()
            .cloned()
            .ok_or_else(|| "no sample".to_owned())
    }

    fn apply(&mut self, action: Action) -> Result<(), String> {
        self.actions.lock().unwrap().push(action);
        Ok(())
    }
}

fn sample() -> RuntimeSample {
    RuntimeSample {
        now_ms: 0,
        cursor: Point {
            x: 1919.0,
            y: 500.0,
        },
        monitor: MonitorRect::new(0.0, 0.0, 1920.0, 1080.0, 1.0),
        window: WindowState::hidden(),
    }
}

#[test]
fn runtime_uses_a_25_ms_default_interval() {
    assert_eq!(
        SamplingRuntime::default_interval(),
        Duration::from_millis(25)
    );
}

#[test]
fn runtime_can_be_stopped_without_leaking_worker_thread() {
    let actions = Arc::new(Mutex::new(Vec::new()));
    let runtime = SamplingRuntime::start(
        FakePort {
            samples: vec![sample()],
            actions: actions.clone(),
        },
        HotZoneEngine::new(2.0, 150, 0),
        Duration::from_millis(1),
    );
    std::thread::sleep(Duration::from_millis(5));
    runtime.stop().unwrap();
    assert!(actions.lock().unwrap().is_empty());
}

#[test]
fn runtime_port_can_apply_state_machine_action() {
    let mut engine = HotZoneEngine::new(2.0, 150, 0);
    let initial = sample();
    assert!(engine
        .sample(
            initial.now_ms,
            initial.cursor,
            initial.monitor.clone(),
            initial.window
        )
        .is_empty());
    let result = engine.sample(150, initial.cursor, initial.monitor, initial.window);
    assert_eq!(result, vec![Action::Show]);
    assert_eq!(sample().window.bounds, None);
    assert_eq!(Rect::new(0.0, 0.0, 1.0, 1.0).width, 1.0);
}

#[test]
fn runtime_reports_action_errors_with_context() {
    let messages = Arc::new(Mutex::new(Vec::new()));
    let recorded = messages.clone();

    report_runtime_result(
        "window Show action",
        Err::<(), _>("native overlay unavailable"),
        move |message| recorded.lock().unwrap().push(message),
    );

    assert_eq!(
        messages.lock().unwrap().as_slice(),
        ["FlowContext window Show action failed: native overlay unavailable"]
    );
}

struct FailingApplyPort {
    sample_calls: Arc<AtomicUsize>,
    apply_calls: Arc<AtomicUsize>,
}

impl RuntimePort for FailingApplyPort {
    fn sample(&mut self) -> Result<RuntimeSample, String> {
        let call = self.sample_calls.fetch_add(1, Ordering::SeqCst);
        let mut next = sample();
        next.now_ms = if call == 0 { 0 } else { 150 };
        Ok(next)
    }

    fn apply(&mut self, _action: Action) -> Result<(), String> {
        self.apply_calls.fetch_add(1, Ordering::SeqCst);
        Err("native overlay unavailable".to_owned())
    }
}

#[test]
fn runtime_keeps_sampling_after_apply_failure() {
    let sample_calls = Arc::new(AtomicUsize::new(0));
    let apply_calls = Arc::new(AtomicUsize::new(0));
    let runtime = SamplingRuntime::start(
        FailingApplyPort {
            sample_calls: sample_calls.clone(),
            apply_calls: apply_calls.clone(),
        },
        HotZoneEngine::new(2.0, 150, 0),
        Duration::from_millis(1),
    );
    let deadline = Instant::now() + Duration::from_millis(100);
    while sample_calls.load(Ordering::SeqCst) < 3 && Instant::now() < deadline {
        std::thread::yield_now();
    }
    runtime.stop().unwrap();

    assert_eq!(apply_calls.load(Ordering::SeqCst), 1);
    assert!(sample_calls.load(Ordering::SeqCst) >= 3);
}

struct TransientSampleFailurePort {
    sample_calls: Arc<AtomicUsize>,
    actions: Arc<Mutex<Vec<Action>>>,
}

impl RuntimePort for TransientSampleFailurePort {
    fn sample(&mut self) -> Result<RuntimeSample, String> {
        let call = self.sample_calls.fetch_add(1, Ordering::SeqCst);
        if call == 0 {
            return Err("temporary cursor query failure".to_owned());
        }
        let mut next = sample();
        next.now_ms = if call == 1 { 0 } else { 150 };
        Ok(next)
    }

    fn apply(&mut self, action: Action) -> Result<(), String> {
        self.actions.lock().unwrap().push(action);
        Ok(())
    }
}

#[test]
fn runtime_recovers_after_a_transient_sample_failure() {
    let sample_calls = Arc::new(AtomicUsize::new(0));
    let actions = Arc::new(Mutex::new(Vec::new()));
    let runtime = SamplingRuntime::start(
        TransientSampleFailurePort {
            sample_calls: sample_calls.clone(),
            actions: actions.clone(),
        },
        HotZoneEngine::new(2.0, 150, 0),
        Duration::from_millis(1),
    );
    let deadline = Instant::now() + Duration::from_millis(100);
    while actions.lock().unwrap().is_empty() && Instant::now() < deadline {
        std::thread::yield_now();
    }
    runtime.stop().unwrap();

    assert!(sample_calls.load(Ordering::SeqCst) >= 3);
    assert_eq!(actions.lock().unwrap().as_slice(), [Action::Show]);
}
