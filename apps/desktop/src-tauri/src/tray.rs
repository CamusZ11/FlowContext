#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrayCommand {
    Show,
    Hide,
    Settings,
    Quit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrayAction {
    Show,
    Hide,
    Settings,
    Quit,
}

impl TrayAction {
    pub const fn command(self) -> TrayCommand {
        match self {
            Self::Show => TrayCommand::Show,
            Self::Hide => TrayCommand::Hide,
            Self::Settings => TrayCommand::Settings,
            Self::Quit => TrayCommand::Quit,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrayMenu {
    commands: Vec<TrayCommand>,
}

impl Default for TrayMenu {
    fn default() -> Self {
        Self {
            commands: vec![
                TrayCommand::Show,
                TrayCommand::Hide,
                TrayCommand::Settings,
                TrayCommand::Quit,
            ],
        }
    }
}

impl TrayMenu {
    pub fn commands(&self) -> Vec<TrayCommand> {
        self.commands.clone()
    }
}

pub fn install<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    use tauri::menu::MenuItemBuilder;
    use tauri::tray::TrayIconBuilder;
    use tauri::{Emitter, Manager};

    let show = MenuItemBuilder::with_id("show", "显示").build(app)?;
    let hide = MenuItemBuilder::with_id("hide", "隐藏").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "设置").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = tauri::menu::MenuBuilder::new(app)
        .items(&[&show, &hide, &settings, &quit])
        .build()?;

    let mut tray = TrayIconBuilder::with_id("flowcontext")
        .menu(&menu)
        .tooltip("FlowContext")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let saved = crate::settings::load(app).unwrap_or_default();
                    let _ = crate::runtime::show_panel(window, saved);
                }
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let saved = crate::settings::load(app).unwrap_or_default();
                    let _ = crate::runtime::hide_panel(window, saved);
                }
            }
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let saved = crate::settings::load(app).unwrap_or_default();
                    let _ = crate::runtime::show_panel(window.clone(), saved);
                    let _ = window.set_focus();
                    let _ = window.emit("flowcontext:open-settings", ());
                }
            }
            "quit" => {
                let runtime = app
                    .try_state::<crate::DesktopRuntimeState>()
                    .and_then(|state| state.0.lock().ok().and_then(|mut guard| guard.take()));
                if let Some(runtime) = runtime {
                    let _ = runtime.stop();
                }
                app.exit(0);
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    Ok(())
}
