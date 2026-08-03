use super::tray::{TrayAction, TrayCommand, TrayMenu};

#[test]
fn tray_contains_show_hide_settings_and_quit() {
    assert_eq!(
        TrayMenu::default().commands(),
        vec![
            TrayCommand::Show,
            TrayCommand::Hide,
            TrayCommand::Settings,
            TrayCommand::Quit,
        ]
    );
}

#[test]
fn tray_action_maps_to_window_command() {
    assert_eq!(TrayAction::Show.command(), TrayCommand::Show);
    assert_eq!(TrayAction::Hide.command(), TrayCommand::Hide);
    assert_eq!(TrayAction::Settings.command(), TrayCommand::Settings);
    assert_eq!(TrayAction::Quit.command(), TrayCommand::Quit);
}
