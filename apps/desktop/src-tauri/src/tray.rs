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

#[cfg(target_os = "macos")]
pub(crate) const APP_QUIT_MENU_ID: &str = "archive-application-quit";

#[cfg(target_os = "macos")]
pub(crate) fn macos_quit_menu(
    app: &tauri::AppHandle,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItemBuilder, MenuItemKind};

    let menu = Menu::default(app)?;
    // The default macOS application submenu is first and ends with its native Quit item.
    let missing_quit = || std::io::Error::other("FlowContext 默认应用菜单缺少退出项");
    let items = menu.items()?;
    let application = items
        .first()
        .and_then(MenuItemKind::as_submenu)
        .ok_or_else(missing_quit)?;
    let items = application.items()?;
    let old_quit = items
        .last()
        .and_then(MenuItemKind::as_predefined_menuitem)
        .ok_or_else(missing_quit)?;
    let quit = MenuItemBuilder::with_id(APP_QUIT_MENU_ID, old_quit.text()?)
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    application.remove(old_quit)?;
    application.append(&quit)?;
    Ok(menu)
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
                    let _ = crate::runtime::show_panel_interactive(window.clone(), saved);
                    let _ = window.emit("flowcontext:open-settings", ());
                }
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    Ok(())
}
