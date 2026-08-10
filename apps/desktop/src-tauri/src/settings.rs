use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};

const SETTINGS_FILE: &str = "device-settings.json";
const SETTINGS_KEY: &str = "settings";

pub const DEFAULT_PANEL_WIDTH: f64 = 420.0;
pub const MIN_PANEL_WIDTH: f64 = 360.0;
pub const MAX_PANEL_WIDTH: f64 = 560.0;
pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct DeviceSettings {
    pub selected_monitor_id: Option<String>,
    pub panel_width: f64,
    pub shortcut: String,
    pub autostart: bool,
    pub hot_zone_enabled: bool,
}

/// Live settings shared by the sampler and Tauri commands.
///
/// The store remains the durable source of truth, but keeping a normalized
/// snapshot in memory means a settings change takes effect on the next
/// sampling tick without restarting the desktop runtime.
#[derive(Clone)]
pub struct DeviceSettingsState(pub Arc<RwLock<DeviceSettings>>);

pub trait SettingsTransactionPort {
    fn apply_shortcut(&mut self, shortcut: &str) -> Result<(), String>;
    fn apply_autostart(&mut self, enabled: bool) -> Result<(), String>;
    fn apply_layout(&mut self, settings: &DeviceSettings) -> Result<(), String>;
    fn persist(&mut self, settings: DeviceSettings) -> Result<(), String>;
}

fn rollback<P: SettingsTransactionPort>(port: &mut P, previous: &DeviceSettings) {
    let _ = port.apply_shortcut(&previous.shortcut);
    let _ = port.apply_autostart(previous.autostart);
    let _ = port.apply_layout(previous);
}

/// Apply externally visible device settings in a recoverable order. The
/// durable store is written last; a failed hotkey, autostart, layout or save
/// therefore never makes a partially-applied setting survive restart.
pub fn apply_settings_transaction<P: SettingsTransactionPort>(
    port: &mut P,
    previous: DeviceSettings,
    requested: DeviceSettings,
) -> Result<DeviceSettings, String> {
    let next = requested.normalized();

    if let Err(error) = port.apply_shortcut(&next.shortcut) {
        let _ = port.apply_shortcut(&previous.shortcut);
        return Err(format!("快捷键未更新，已恢复原快捷键：{error}"));
    }
    if let Err(error) = port.apply_autostart(next.autostart) {
        let _ = port.apply_shortcut(&previous.shortcut);
        return Err(format!("开机启动未更新，已恢复原快捷键：{error}"));
    }
    if let Err(error) = port.apply_layout(&next) {
        rollback(port, &previous);
        return Err(format!("显示器或窗口布局未更新，已恢复原设置：{error}"));
    }
    if let Err(error) = port.persist(next.clone()) {
        rollback(port, &previous);
        return Err(format!("设备设置未保存，已恢复原设置：{error}"));
    }
    Ok(next)
}

impl DeviceSettingsState {
    pub fn new(settings: DeviceSettings) -> Self {
        Self(Arc::new(RwLock::new(settings.normalized())))
    }

    pub fn snapshot(&self) -> DeviceSettings {
        match self.0.read() {
            Ok(settings) => settings.clone().normalized(),
            Err(poisoned) => poisoned.into_inner().clone().normalized(),
        }
    }

    pub fn replace(&self, settings: DeviceSettings) -> DeviceSettings {
        let normalized = settings.normalized();
        match self.0.write() {
            Ok(mut current) => *current = normalized.clone(),
            Err(poisoned) => *poisoned.into_inner() = normalized.clone(),
        }
        normalized
    }
}

impl Default for DeviceSettings {
    fn default() -> Self {
        Self {
            selected_monitor_id: None,
            panel_width: DEFAULT_PANEL_WIDTH,
            shortcut: DEFAULT_SHORTCUT.to_owned(),
            autostart: true,
            hot_zone_enabled: true,
        }
    }
}

impl DeviceSettings {
    pub fn clamp_panel_width(width: f64) -> f64 {
        if !width.is_finite() {
            return DEFAULT_PANEL_WIDTH;
        }
        width.clamp(MIN_PANEL_WIDTH, MAX_PANEL_WIDTH)
    }

    pub fn normalized(mut self) -> Self {
        self.panel_width = Self::clamp_panel_width(self.panel_width);
        if self.shortcut.trim().is_empty() {
            self.shortcut = DEFAULT_SHORTCUT.to_owned();
        }
        self
    }
}

pub fn load<R: tauri::Runtime, M: tauri::Manager<R>>(
    manager: &M,
) -> Result<DeviceSettings, String> {
    use tauri_plugin_store::StoreExt;

    let store = manager
        .store(SETTINGS_FILE)
        .map_err(|error| error.to_string())?;
    Ok(store
        .get(SETTINGS_KEY)
        .and_then(|value| serde_json::from_value::<DeviceSettings>(value).ok())
        .unwrap_or_default()
        .normalized())
}

pub fn save<R: tauri::Runtime, M: tauri::Manager<R>>(
    manager: &M,
    settings: DeviceSettings,
) -> Result<DeviceSettings, String> {
    use tauri_plugin_store::StoreExt;

    let normalized = settings.normalized();
    let store = manager
        .store(SETTINGS_FILE)
        .map_err(|error| error.to_string())?;
    store.set(
        SETTINGS_KEY,
        serde_json::to_value(&normalized).map_err(|error| error.to_string())?,
    );
    store.save().map_err(|error| error.to_string())?;
    Ok(normalized)
}

#[tauri::command]
pub fn get_device_settings(
    state: tauri::State<'_, DeviceSettingsState>,
) -> Result<DeviceSettings, String> {
    Ok(state.snapshot())
}

#[tauri::command]
pub fn set_device_settings(
    app: tauri::AppHandle<tauri::Wry>,
    state: tauri::State<'_, DeviceSettingsState>,
    settings: DeviceSettings,
) -> Result<DeviceSettings, String> {
    let previous = state.snapshot();
    let mut port = TauriSettingsTransactionPort { app: &app };
    let next = apply_settings_transaction(&mut port, previous, settings)?;
    Ok(state.replace(next))
}

/// Re-register the persisted shortcut after the global-shortcut plugin has
/// been installed. This is shared by startup and the transactional settings
/// path so a restart never silently falls back to the compile-time default.
pub fn install_shortcut(app: &tauri::AppHandle<tauri::Wry>, shortcut: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let parsed = shortcut
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .map_err(|error| error.to_string())?;
    let manager = app.global_shortcut();
    manager
        .unregister_all()
        .map_err(|error| error.to_string())?;
    manager.register(parsed).map_err(|error| error.to_string())
}

struct TauriSettingsTransactionPort<'a> {
    app: &'a tauri::AppHandle<tauri::Wry>,
}

impl SettingsTransactionPort for TauriSettingsTransactionPort<'_> {
    fn apply_shortcut(&mut self, shortcut: &str) -> Result<(), String> {
        install_shortcut(self.app, shortcut)
    }

    fn apply_autostart(&mut self, enabled: bool) -> Result<(), String> {
        use tauri_plugin_autostart::ManagerExt;

        let manager = self.app.autolaunch();
        if enabled {
            manager.enable().map_err(|error| error.to_string())
        } else {
            manager.disable().map_err(|error| error.to_string())
        }
    }

    fn apply_layout(&mut self, settings: &DeviceSettings) -> Result<(), String> {
        use tauri::Manager;

        if !settings.hot_zone_enabled {
            if let Some(runtime) = self.app.try_state::<crate::DesktopRuntimeState>() {
                if let Ok(guard) = runtime.0.lock() {
                    if let Some(runtime) = guard.as_ref() {
                        runtime.reset_hot_zone();
                    }
                }
            }
        }
        let Some(window) = self.app.get_webview_window("main") else {
            return Ok(());
        };
        if window.is_visible().map_err(|error| error.to_string())? {
            crate::runtime::show_panel(window, settings.clone())?;
        }
        Ok(())
    }

    fn persist(&mut self, settings: DeviceSettings) -> Result<(), String> {
        save(self.app, settings).map(|_| ())
    }
}
