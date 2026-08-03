use super::plugins::{DEFAULT_SHORTCUT, PLUGIN_ORDER};

#[test]
fn lifecycle_plugins_are_registered_in_safe_order() {
    assert_eq!(PLUGIN_ORDER[0], "single-instance");
    assert!(PLUGIN_ORDER.contains(&"store"));
    assert!(PLUGIN_ORDER.contains(&"global-shortcut"));
    assert_eq!(DEFAULT_SHORTCUT, "CommandOrControl+Shift+Space");
}
