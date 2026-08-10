use crate::settings::DeviceSettingsState;
use serde::Serialize;
use tauri::Manager;

/// Deliberately small diagnostics payload. It must never receive auth, prompt,
/// full URI, workspace or database fields from callers.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct DiagnosticsSnapshot {
    pub app_version: String,
    pub commit: String,
    pub platform: String,
    pub webview_version: Option<String>,
    pub selected_monitor_hash: Option<String>,
    pub monitor_rectangles: Vec<String>,
    pub scale_factors: Vec<f64>,
    pub window_bounds: Option<String>,
    pub heat_zone_enabled: bool,
    pub sse_state: String,
    pub launcher_result: String,
}

impl DiagnosticsSnapshot {
    pub fn to_redacted_json(&self) -> Result<String, String> {
        let value = serde_json::to_string(self).map_err(|error| error.to_string())?;
        let lower = value.to_ascii_lowercase();
        if [
            "authorization",
            "token",
            "cookie",
            "prompt",
            "codex://",
            "postgres",
            "password",
        ]
        .iter()
        .any(|needle| lower.contains(needle))
        {
            return Err("diagnostics payload contains a prohibited sensitive field".to_owned());
        }
        Ok(value)
    }
}

/// A small deterministic hash lets support correlate a display across a
/// report without exposing its device name. It is an identifier, not a secret.
pub fn redact_monitor_id(value: &str) -> String {
    let hash = value
        .bytes()
        .fold(0xcbf2_9ce4_8422_2325_u64, |current, byte| {
            (current ^ byte as u64).wrapping_mul(0x0000_0100_0000_01b3)
        });
    format!("monitor-{hash:016x}")
}

#[tauri::command]
pub fn get_diagnostics(
    app: tauri::AppHandle<tauri::Wry>,
    state: tauri::State<'_, DeviceSettingsState>,
) -> Result<String, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window unavailable".to_owned())?;
    let monitors = crate::runtime::collect_monitor_descriptors(&window)?;
    let settings = state.snapshot();
    let selected_monitor_hash = if monitors.is_empty() {
        None
    } else {
        let selected = crate::monitor::resolve_selected_monitor(
            settings.selected_monitor_id.as_deref(),
            &monitors,
        );
        Some(redact_monitor_id(&selected.id))
    };
    let bounds = window
        .outer_position()
        .ok()
        .zip(window.outer_size().ok())
        .map(|(position, size)| {
            format!(
                "{},{},{},{}",
                position.x, position.y, size.width, size.height
            )
        });
    DiagnosticsSnapshot {
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        commit: option_env!("FLOWCONTEXT_COMMIT")
            .unwrap_or("unknown")
            .to_owned(),
        platform: crate::native_commands::runtime_platform().to_owned(),
        // WebView2 version is intentionally supplied by the Windows doctor
        // until a tested native query is available. Do not guess or log it.
        webview_version: None,
        selected_monitor_hash,
        monitor_rectangles: monitors
            .iter()
            .map(|monitor| {
                format!(
                    "{},{},{},{}",
                    monitor.rect.x, monitor.rect.y, monitor.rect.width, monitor.rect.height
                )
            })
            .collect(),
        scale_factors: monitors
            .iter()
            .map(|monitor| monitor.rect.scale_factor)
            .collect(),
        window_bounds: bounds,
        heat_zone_enabled: settings.hot_zone_enabled,
        // SSE and launcher handling belong to the WebView; native diagnostics
        // must not collect their potentially sensitive payloads.
        sse_state: "webview-managed".to_owned(),
        launcher_result: "not-recorded".to_owned(),
    }
    .to_redacted_json()
}
