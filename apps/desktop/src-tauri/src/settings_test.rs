use super::settings::{DeviceSettings, DeviceSettingsState, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH};

#[test]
fn defaults_keep_only_device_preferences() {
    let settings = DeviceSettings::default();
    assert_eq!(settings.panel_width, 420.0);
    assert_eq!(settings.selected_monitor_id, None);
    assert_eq!(settings.shortcut, "CommandOrControl+Shift+Space");
    assert!(settings.autostart);
}

#[test]
fn panel_width_is_clamped_to_360_560_logical_pixels() {
    assert_eq!(DeviceSettings::clamp_panel_width(100.0), MIN_PANEL_WIDTH);
    assert_eq!(DeviceSettings::clamp_panel_width(900.0), MAX_PANEL_WIDTH);
    assert_eq!(DeviceSettings::clamp_panel_width(480.0), 480.0);
}

#[test]
fn invalid_persisted_values_are_normalized() {
    let settings = DeviceSettings {
        panel_width: f64::NAN,
        shortcut: "".to_owned(),
        ..DeviceSettings::default()
    }
    .normalized();
    assert_eq!(settings.panel_width, 420.0);
    assert_eq!(settings.shortcut, "CommandOrControl+Shift+Space");
}

#[test]
fn live_settings_state_updates_the_sampler_snapshot() {
    let state = DeviceSettingsState::new(DeviceSettings::default());
    assert_eq!(state.snapshot().panel_width, 420.0);

    let updated = state.replace(DeviceSettings {
        panel_width: 560.0,
        selected_monitor_id: Some("display@-1920,0".to_owned()),
        ..DeviceSettings::default()
    });

    assert_eq!(updated.panel_width, 560.0);
    assert_eq!(
        state.snapshot().selected_monitor_id.as_deref(),
        Some("display@-1920,0")
    );
}
