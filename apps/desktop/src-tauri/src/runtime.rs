use crate::display_geometry::DisplayGeometry;
use crate::hot_zone::{Action, HotZoneEngine, MonitorRect, Point, WindowState};
use crate::monitor::{
    monitor_options, resolve_selected_monitor, with_external_segments, MonitorDescriptor,
    MonitorOption,
};
use crate::platform_window::{ShowIntent, WindowPlacement};
use crate::settings::{DeviceSettings, DeviceSettingsState};
use crate::window_controller::{WindowController, WindowPort};
use std::fmt::Display;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use std::time::Instant;
use tauri::Manager;

#[derive(Clone, Debug)]
pub struct RuntimeSample {
    pub now_ms: u64,
    pub cursor: Point,
    pub monitor: MonitorRect,
    pub window: WindowState,
}

pub trait RuntimePort: Send {
    fn sample(&mut self) -> Result<RuntimeSample, String>;
    fn apply(&mut self, action: Action) -> Result<(), String>;
}

pub(crate) fn report_runtime_result<E: Display>(
    context: &str,
    result: Result<(), E>,
    report: impl FnOnce(String),
) {
    if let Err(error) = result {
        report(format!("FlowContext {context} failed: {error}"));
    }
}

pub struct SamplingRuntime {
    stop: Arc<AtomicBool>,
    reset_hot_zone: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl SamplingRuntime {
    pub fn default_interval() -> Duration {
        Duration::from_millis(25)
    }

    pub fn start<P: RuntimePort + 'static>(
        mut port: P,
        mut engine: HotZoneEngine,
        interval: Duration,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_worker = stop.clone();
        let reset_hot_zone = Arc::new(AtomicBool::new(false));
        let reset_worker = reset_hot_zone.clone();
        let worker = thread::Builder::new()
            .name("flowcontext-hot-zone".to_owned())
            .spawn(move || {
                let mut last_sample_error = None;
                while !stop_worker.load(Ordering::Acquire) {
                    if reset_worker.swap(false, Ordering::AcqRel) {
                        engine.reset();
                    }
                    match port.sample() {
                        Ok(sample) => {
                            if stop_worker.load(Ordering::Acquire) {
                                break;
                            }
                            last_sample_error = None;
                            let actions = engine.sample(
                                sample.now_ms,
                                sample.cursor,
                                sample.monitor,
                                sample.window,
                            );
                            for action in actions {
                                let context = format!("hot-zone {action:?} action");
                                report_runtime_result(&context, port.apply(action), |message| {
                                    eprintln!("{message}");
                                });
                            }
                        }
                        Err(error) => {
                            if last_sample_error.as_deref() != Some(error.as_str()) {
                                eprintln!("FlowContext hot-zone sampling failed: {error}");
                            }
                            last_sample_error = Some(error);
                        }
                    }
                    thread::sleep(interval);
                }
            })
            .expect("spawn FlowContext hot-zone worker");
        Self {
            stop,
            reset_hot_zone,
            worker: Some(worker),
        }
    }

    pub fn stop(mut self) -> Result<(), String> {
        self.stop.store(true, Ordering::Release);
        self.worker
            .take()
            .expect("runtime worker exists")
            .join()
            .map_err(|_| "runtime worker panicked".to_owned())
    }

    /// Retire a sampler that may be blocked inside a native call while macOS
    /// is asleep. A wake recovery can immediately install a fresh sampler;
    /// this worker will exit without applying actions if its native call later
    /// returns.
    pub fn retire(mut self) {
        self.stop.store(true, Ordering::Release);
        drop(self.worker.take());
    }

    /// Cancel a dwell that was started under now-invalid settings. The worker
    /// observes this before its next 25ms sample, so disabling the heat zone
    /// cannot later reveal a panel from a stale edge entry.
    pub fn reset_hot_zone(&self) {
        self.reset_hot_zone.store(true, Ordering::Release);
    }
}

impl Drop for SamplingRuntime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// Adapter used by the real Tauri shell.  It is intentionally kept behind the
/// generic [`RuntimePort`] seam so unit tests never need to create a GUI.
pub struct TauriRuntimePort<R: tauri::Runtime> {
    window: tauri::WebviewWindow<R>,
    settings: DeviceSettingsState,
    started_at: Instant,
    transition_until_ms: Arc<AtomicU64>,
    monitor_cache: Option<MonitorCache>,
}

#[derive(Clone, Debug)]
struct MonitorCache {
    selected_monitor_id: Option<String>,
    monitor: MonitorRect,
    refreshed_at: Instant,
}

const MONITOR_REFRESH_INTERVAL: Duration = Duration::from_secs(1);

impl<R: tauri::Runtime> TauriRuntimePort<R> {
    pub fn new(window: tauri::WebviewWindow<R>, settings: DeviceSettings) -> Self {
        Self::new_with_state(window, DeviceSettingsState::new(settings))
    }

    pub fn new_with_state(window: tauri::WebviewWindow<R>, settings: DeviceSettingsState) -> Self {
        Self {
            window,
            settings,
            started_at: Instant::now(),
            transition_until_ms: Arc::new(AtomicU64::new(0)),
            monitor_cache: None,
        }
    }

    fn now_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }

    fn monitors(&self) -> Result<Vec<MonitorDescriptor>, String> {
        collect_monitor_descriptors(&self.window)
    }

    fn settings_snapshot(&self) -> DeviceSettings {
        self.settings.snapshot()
    }

    fn controller(&self) -> WindowController {
        let settings = self.settings_snapshot();
        WindowController::new(
            settings.panel_width,
            crate::settings::MIN_PANEL_WIDTH,
            crate::settings::MAX_PANEL_WIDTH,
        )
    }

    fn selected_monitor(&mut self) -> Result<MonitorRect, String> {
        let settings = self.settings_snapshot();
        let selected_monitor_id = settings.selected_monitor_id.clone();
        if let Some(cache) = &self.monitor_cache {
            if cache.selected_monitor_id == selected_monitor_id
                && cache.refreshed_at.elapsed() < MONITOR_REFRESH_INTERVAL
            {
                return Ok(cache
                    .monitor
                    .clone()
                    .with_enabled(settings.hot_zone_enabled));
            }
        }

        match self.monitors() {
            Ok(monitors) => {
                let selected = resolve_selected_monitor(selected_monitor_id.as_deref(), &monitors);
                let monitor = with_external_segments(selected, &monitors);
                self.monitor_cache = Some(MonitorCache {
                    selected_monitor_id,
                    monitor: monitor.clone(),
                    refreshed_at: Instant::now(),
                });
                Ok(monitor.with_enabled(settings.hot_zone_enabled))
            }
            Err(error) => self
                .monitor_cache
                .as_ref()
                .filter(|cache| cache.selected_monitor_id == selected_monitor_id)
                .map(|cache| cache.monitor.clone())
                .ok_or(error),
        }
    }

    fn selected_display(&mut self) -> Result<DisplayGeometry, String> {
        let monitor = self.selected_monitor()?;
        crate::platform_window::display_geometry(
            &self.window,
            crate::hot_zone::Rect::new(monitor.x, monitor.y, monitor.width, monitor.height),
            monitor.scale_factor,
        )
    }
}

pub fn collect_monitor_descriptors<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<Vec<MonitorDescriptor>, String> {
    let available = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let primary = window
        .primary_monitor()
        .map_err(|error| error.to_string())?;
    let primary_key = primary.as_ref().map(monitor_key);
    Ok(available
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            let position = monitor.position();
            let size = monitor.size();
            let name = monitor.name().cloned();
            let fallback_id = name
                .as_ref()
                .map(|name| format!("{name}@{},{}", position.x, position.y))
                .unwrap_or_else(|| format!("display@{},{}", position.x, position.y));
            #[cfg(target_os = "windows")]
            let id = crate::windows_window::stable_id_for_bounds(crate::hot_zone::Rect::new(
                position.x as f64,
                position.y as f64,
                size.width as f64,
                size.height as f64,
            ))
            .unwrap_or(fallback_id);
            #[cfg(not(target_os = "windows"))]
            let id = fallback_id;
            let label = name.unwrap_or_else(|| format!("显示器 {}", index + 1));
            MonitorDescriptor::new(
                id,
                label,
                MonitorRect::new(
                    position.x as f64,
                    position.y as f64,
                    size.width as f64,
                    size.height as f64,
                    monitor.scale_factor(),
                ),
                primary_key.as_ref() == Some(&monitor_key(monitor)),
            )
        })
        .collect())
}

fn monitor_key(monitor: &tauri::Monitor) -> (Option<String>, i32, i32) {
    let position = monitor.position();
    (monitor.name().cloned(), position.x, position.y)
}

#[tauri::command]
pub fn list_monitors(app: tauri::AppHandle<tauri::Wry>) -> Result<Vec<MonitorOption>, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window unavailable".to_owned())?;
    Ok(monitor_options(&collect_monitor_descriptors(&window)?))
}

/// Synchronous window actions used by the tray and global shortcut.  Keeping
/// these actions on the same controller path as the sampler ensures a manual
/// fallback still snaps the panel to the selected monitor's right edge.
pub fn show_panel<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    settings: DeviceSettings,
) -> Result<(), String> {
    show_panel_with_intent(window, settings, ShowIntent::Passive)
}

/// The Settings command is the sole tray-driven interactive reveal. Generic
/// Show, a shortcut and the heat-zone sampler all retain the passive intent.
pub fn show_panel_interactive<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    settings: DeviceSettings,
) -> Result<(), String> {
    show_panel_with_intent(window, settings, ShowIntent::Interactive)
}

fn show_panel_with_intent<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    settings: DeviceSettings,
    intent: ShowIntent,
) -> Result<(), String> {
    let mut port = TauriRuntimePort::new(window.clone(), settings);
    let display = port.selected_display()?;
    let controller = port.controller();
    let mut window_port = TauriWindowPort {
        window: window.clone(),
    };
    let result = controller
        .show_with_intent(&mut window_port, &display, intent)
        .map_err(|error| error.to_string());
    if result.is_ok() {
        use tauri::Emitter;
        let _ = window.emit("flowcontext:shown", ());
    }
    result
}

pub(crate) const fn manual_panel_action(requested: Action) -> Action {
    requested
}

pub fn hide_panel<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    settings: DeviceSettings,
) -> Result<(), String> {
    apply_manual_panel_action(window, settings, manual_panel_action(Action::Hide))
}

pub fn toggle_panel<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    settings: DeviceSettings,
) -> Result<(), String> {
    let mut port = TauriRuntimePort::new(window.clone(), settings);
    let display = port.selected_display()?;
    let controller = port.controller();
    let mut window_port = TauriWindowPort { window };
    controller
        .toggle(&mut window_port, &display)
        .map_err(|error| error.to_string())
}

fn apply_manual_panel_action<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    settings: DeviceSettings,
    action: Action,
) -> Result<(), String> {
    let mut port = TauriRuntimePort::new(window.clone(), settings);
    let display = port.selected_display()?;
    let controller = port.controller();
    let mut window_port = TauriWindowPort { window };
    match action {
        Action::Show => controller.show(&mut window_port, &display),
        Action::Hide => controller.hide(&mut window_port, &display),
    }
    .map_err(|error| error.to_string())
}

/// Recreate the sampling path after macOS wakes. Native display and cursor
/// queries can remain blocked across sleep, so the old worker is retired
/// without joining and a new port starts with an empty monitor cache.
pub fn restart_sampling_after_wake<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    settings: DeviceSettingsState,
    sampling: &std::sync::Mutex<Option<SamplingRuntime>>,
) -> Result<(), String> {
    crate::platform_window::prepare_overlay(&window)?;

    let previous = sampling
        .lock()
        .map_err(|_| "FlowContext hot-zone runtime lock poisoned".to_owned())?
        .take();
    if let Some(runtime) = previous {
        runtime.retire();
    }

    let replacement = SamplingRuntime::start(
        TauriRuntimePort::new_with_state(window, settings),
        HotZoneEngine::new(2.0, 150, 0),
        SamplingRuntime::default_interval(),
    );
    *sampling
        .lock()
        .map_err(|_| "FlowContext hot-zone runtime lock poisoned".to_owned())? = Some(replacement);
    Ok(())
}

impl<R: tauri::Runtime> RuntimePort for TauriRuntimePort<R> {
    fn sample(&mut self) -> Result<RuntimeSample, String> {
        let cursor = self
            .window
            .cursor_position()
            .map_err(|error| error.to_string())?;
        let monitor = self.selected_monitor()?;
        let display = crate::platform_window::display_geometry(
            &self.window,
            crate::hot_zone::Rect::new(monitor.x, monitor.y, monitor.width, monitor.height),
            monitor.scale_factor,
        )?;
        // A right-side taskbar owns the physical edge, so it must suppress
        // the sampler as well as using rcWork for the panel rectangle.
        let hot_zone_enabled = monitor.enabled && display.hot_zone_enabled();
        let monitor = monitor.with_enabled(hot_zone_enabled);
        let visible = self
            .window
            .is_visible()
            .map_err(|error| error.to_string())?;
        let bounds = if visible {
            let position = self
                .window
                .outer_position()
                .map_err(|error| error.to_string())?;
            let size = self
                .window
                .outer_size()
                .map_err(|error| error.to_string())?;
            Some(crate::hot_zone::Rect::new(
                position.x as f64,
                position.y as f64,
                size.width as f64,
                size.height as f64,
            ))
        } else {
            None
        };
        let now_ms = self.now_ms();
        let transitioning = self.transition_until_ms.load(Ordering::Acquire) > now_ms;
        Ok(RuntimeSample {
            now_ms,
            cursor: Point {
                x: cursor.x,
                y: cursor.y,
            },
            monitor,
            window: WindowState {
                visible,
                animating: transitioning,
                bounds,
            },
        })
    }

    fn apply(&mut self, action: Action) -> Result<(), String> {
        let window = self.window.clone();
        let scheduler = window.clone();
        let display = self.selected_display()?;
        let controller = self.controller();
        let transition_until = self.transition_until_ms.clone();
        let until = self.now_ms().saturating_add(controller.animation_ms);
        transition_until.store(until, Ordering::Release);
        scheduler
            .run_on_main_thread(move || {
                let mut port = TauriWindowPort { window };
                let result = match action {
                    Action::Show => controller.show(&mut port, &display),
                    Action::Hide => controller.hide(&mut port, &display),
                };
                let context = format!("window {action:?} action");
                report_runtime_result(&context, result, |message| {
                    eprintln!("{message}");
                });
            })
            .map_err(|error| error.to_string())
    }
}

struct TauriWindowPort<R: tauri::Runtime> {
    window: tauri::WebviewWindow<R>,
}

impl<R: tauri::Runtime> WindowPort for TauriWindowPort<R> {
    fn prepare_overlay(&mut self) -> Result<(), String> {
        crate::platform_window::prepare_overlay(&self.window)
    }

    fn place_and_show(&mut self, placement: WindowPlacement) -> Result<(), String> {
        crate::platform_window::place_and_show(&self.window, placement)
    }

    fn hide_at(&mut self, x: f64, y: f64) -> Result<(), String> {
        crate::platform_window::hide(&self.window, x, y)
    }

    fn is_visible(&self) -> bool {
        self.window.is_visible().unwrap_or(false)
    }
}
