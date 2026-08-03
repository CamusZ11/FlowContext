pub mod hot_zone;
pub mod macos_window;
pub mod monitor;
pub mod native_commands;
pub mod plugins;
pub mod runtime;
pub mod settings;
pub mod tray;
pub mod window_controller;

use std::sync::Mutex;

#[cfg(test)]
mod hot_zone_test;
#[cfg(all(test, target_os = "macos"))]
mod macos_window_test;
#[cfg(test)]
mod monitor_test;
#[cfg(test)]
mod native_commands_test;
#[cfg(test)]
mod plugins_test;
#[cfg(test)]
mod runtime_test;
#[cfg(test)]
mod settings_test;
#[cfg(test)]
mod tray_test;
#[cfg(test)]
mod window_controller_test;

pub struct DesktopRuntimeState(pub Mutex<Option<runtime::SamplingRuntime>>);

pub fn run() {
    use tauri::Manager;

    let shortcut_plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_shortcut(plugins::DEFAULT_SHORTCUT)
        .expect("default FlowContext shortcut is valid")
        .with_handler(|app, _shortcut, _event| {
            if let Some(window) = app.get_webview_window("main") {
                let saved = settings::load(app).unwrap_or_default();
                let _ = runtime::toggle_panel(window, saved);
            }
        })
        .build();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            settings::get_device_settings,
            settings::set_device_settings,
            runtime::list_monitors,
            native_commands::secure_storage_get,
            native_commands::secure_storage_set,
            native_commands::secure_storage_remove,
            native_commands::open_codex_link
        ])
        // This plugin must be registered first: a second launch focuses this
        // window and exits before constructing another store or runtime.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let saved = settings::load(app).unwrap_or_default();
                let _ = runtime::show_panel(window, saved);
            }
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(shortcut_plugin)
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            tray::install(&app.handle())?;
            let settings = settings::load(app.handle()).unwrap_or_default();
            let settings_state = settings::DeviceSettingsState::new(settings);
            app.manage(settings_state.clone());
            if let Some(window) = app.get_webview_window("main") {
                macos_window::prepare_fullscreen_overlay(&window)?;
                let port = runtime::TauriRuntimePort::new_with_state(window, settings_state);
                let sampling = runtime::SamplingRuntime::start(
                    port,
                    hot_zone::HotZoneEngine::new(2.0, 150, 0),
                    runtime::SamplingRuntime::default_interval(),
                );
                app.manage(DesktopRuntimeState(Mutex::new(Some(sampling))));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running FlowContext desktop application");
}
