use crate::hot_zone::{Action, HotZoneEngine, MonitorRect, Point, WindowState};
use crate::monitor::{
    monitor_options, resolve_selected_monitor, with_external_segments, MonitorDescriptor,
    MonitorOption,
};
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
        let worker = thread::Builder::new()
            .name("flowcontext-hot-zone".to_owned())
            .spawn(move || {
                while !stop_worker.load(Ordering::Acquire) {
                    if let Ok(sample) = port.sample() {
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
                    thread::sleep(interval);
                }
            })
            .expect("spawn FlowContext hot-zone worker");
        Self {
            stop,
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
}

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

    fn selected_monitor(&self) -> Result<MonitorRect, String> {
        let monitors = self.monitors()?;
        let settings = self.settings_snapshot();
        let selected = resolve_selected_monitor(settings.selected_monitor_id.as_deref(), &monitors);
        Ok(with_external_segments(selected, &monitors))
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
            let id = name
                .as_ref()
                .map(|name| format!("{name}@{},{}", position.x, position.y))
                .unwrap_or_else(|| format!("display@{},{}", position.x, position.y));
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
    let port = TauriRuntimePort::new(window.clone(), settings);
    let monitor = port.selected_monitor()?;
    let controller = port.controller();
    let mut window_port = TauriWindowPort { window };
    controller
        .show(&mut window_port, monitor)
        .map_err(|error| error.to_string())
}

pub fn hide_panel<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    settings: DeviceSettings,
) -> Result<(), String> {
    let port = TauriRuntimePort::new(window.clone(), settings);
    let monitor = port.selected_monitor()?;
    let controller = port.controller();
    let mut window_port = TauriWindowPort { window };
    controller
        .hide(&mut window_port, monitor)
        .map_err(|error| error.to_string())
}

pub fn toggle_panel<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    settings: DeviceSettings,
) -> Result<(), String> {
    let port = TauriRuntimePort::new(window.clone(), settings);
    let monitor = port.selected_monitor()?;
    let controller = port.controller();
    let mut window_port = TauriWindowPort { window };
    controller
        .toggle(&mut window_port, monitor)
        .map_err(|error| error.to_string())
}

impl<R: tauri::Runtime> RuntimePort for TauriRuntimePort<R> {
    fn sample(&mut self) -> Result<RuntimeSample, String> {
        let cursor = self
            .window
            .cursor_position()
            .map_err(|error| error.to_string())?;
        let monitor = self.selected_monitor()?;
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
        let monitor = self.selected_monitor()?;
        let controller = self.controller();
        let transition_until = self.transition_until_ms.clone();
        let until = self.now_ms().saturating_add(controller.animation_ms);
        transition_until.store(until, Ordering::Release);
        scheduler
            .run_on_main_thread(move || {
                let mut port = TauriWindowPort { window };
                let result = match action {
                    Action::Show => controller.show(&mut port, monitor),
                    Action::Hide => controller.hide(&mut port, monitor),
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
        crate::macos_window::prepare_fullscreen_overlay(&self.window)
    }

    fn set_physical_size(&mut self, width: f64, height: f64) -> Result<(), String> {
        self.window
            .set_size(tauri::PhysicalSize::new(
                width.round().max(1.0) as u32,
                height.round().max(1.0) as u32,
            ))
            .map_err(|error| error.to_string())
    }

    fn set_physical_position(&mut self, x: f64, y: f64) -> Result<(), String> {
        self.window
            .set_position(tauri::PhysicalPosition::new(
                x.round() as i32,
                y.round() as i32,
            ))
            .map_err(|error| error.to_string())
    }

    fn set_always_on_top(&mut self, value: bool) -> Result<(), String> {
        self.window
            .set_always_on_top(value)
            .map_err(|error| error.to_string())
    }

    fn show(&mut self) -> Result<(), String> {
        self.window.show().map_err(|error| error.to_string())
    }

    fn hide(&mut self) -> Result<(), String> {
        self.window.hide().map_err(|error| error.to_string())
    }

    fn is_visible(&self) -> bool {
        self.window.is_visible().unwrap_or(false)
    }
}
