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
    let normalized = save(&app, settings)?;
    Ok(state.replace(normalized))
}
