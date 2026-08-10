use super::settings::{
    apply_settings_transaction, DeviceSettings, DeviceSettingsState, SettingsTransactionPort,
    MAX_PANEL_WIDTH, MIN_PANEL_WIDTH,
};

#[derive(Default)]
struct FakeTransactionPort {
    operations: Vec<String>,
    fail_at: Option<&'static str>,
    persisted: Option<DeviceSettings>,
}

impl SettingsTransactionPort for FakeTransactionPort {
    fn apply_shortcut(&mut self, shortcut: &str) -> Result<(), String> {
        self.operations.push(format!("shortcut:{shortcut}"));
        (self.fail_at != Some("shortcut"))
            .then_some(())
            .ok_or_else(|| "shortcut conflict".to_owned())
    }
    fn apply_autostart(&mut self, enabled: bool) -> Result<(), String> {
        self.operations.push(format!("autostart:{enabled}"));
        (self.fail_at != Some("autostart"))
            .then_some(())
            .ok_or_else(|| "autostart denied".to_owned())
    }
    fn apply_layout(&mut self, settings: &DeviceSettings) -> Result<(), String> {
        self.operations.push(format!(
            "layout:{}:{}",
            settings.panel_width, settings.hot_zone_enabled
        ));
        (self.fail_at != Some("layout"))
            .then_some(())
            .ok_or_else(|| "display unavailable".to_owned())
    }
    fn persist(&mut self, settings: DeviceSettings) -> Result<(), String> {
        self.operations.push("persist".to_owned());
        if self.fail_at == Some("persist") {
            return Err("disk error".to_owned());
        }
        self.persisted = Some(settings);
        Ok(())
    }
}

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

#[test]
fn settings_transaction_persists_only_after_hotkey_autostart_and_layout() {
    let previous = DeviceSettings::default();
    let requested = DeviceSettings {
        shortcut: "CommandOrControl+Shift+K".to_owned(),
        autostart: false,
        panel_width: 500.0,
        hot_zone_enabled: false,
        ..previous.clone()
    };
    let mut port = FakeTransactionPort::default();
    let next = apply_settings_transaction(&mut port, previous, requested).unwrap();
    assert_eq!(next.panel_width, 500.0);
    assert_eq!(
        port.operations,
        [
            "shortcut:CommandOrControl+Shift+K",
            "autostart:false",
            "layout:500:false",
            "persist"
        ]
    );
    assert_eq!(port.persisted, Some(next));
}

#[test]
fn autostart_failure_restores_the_previous_shortcut_without_persisting() {
    let previous = DeviceSettings::default();
    let mut port = FakeTransactionPort {
        fail_at: Some("autostart"),
        ..Default::default()
    };
    let result = apply_settings_transaction(
        &mut port,
        previous.clone(),
        DeviceSettings {
            shortcut: "CommandOrControl+Shift+K".to_owned(),
            ..previous.clone()
        },
    );
    assert!(result.unwrap_err().contains("已恢复原快捷键"));
    assert_eq!(
        port.operations,
        [
            "shortcut:CommandOrControl+Shift+K",
            "autostart:true",
            "shortcut:CommandOrControl+Shift+Space"
        ]
    );
    assert_eq!(port.persisted, None);
}

#[test]
fn hotkey_conflict_attempts_to_restore_the_previous_shortcut_without_persisting() {
    let previous = DeviceSettings::default();
    let mut port = FakeTransactionPort {
        fail_at: Some("shortcut"),
        ..Default::default()
    };
    let result = apply_settings_transaction(
        &mut port,
        previous.clone(),
        DeviceSettings {
            shortcut: "CommandOrControl+Shift+K".to_owned(),
            ..previous.clone()
        },
    );
    assert!(result.unwrap_err().contains("已恢复原快捷键"));
    assert_eq!(
        port.operations,
        [
            "shortcut:CommandOrControl+Shift+K",
            "shortcut:CommandOrControl+Shift+Space"
        ]
    );
    assert_eq!(port.persisted, None);
}

#[test]
fn persistence_failure_restores_all_live_effects_without_writing_new_settings() {
    let previous = DeviceSettings::default();
    let mut port = FakeTransactionPort {
        fail_at: Some("persist"),
        ..Default::default()
    };
    let result = apply_settings_transaction(
        &mut port,
        previous.clone(),
        DeviceSettings {
            panel_width: 500.0,
            autostart: false,
            shortcut: "CommandOrControl+Shift+K".to_owned(),
            ..previous.clone()
        },
    );
    assert!(result.unwrap_err().contains("已恢复原设置"));
    assert_eq!(port.persisted, None);
    assert_eq!(port.operations.last(), Some(&"layout:420:true".to_owned()));
}
