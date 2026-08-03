pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";

/// The single-instance plugin must run before the UI/storage plugins so a
/// second launch can focus the existing window without constructing a second
/// store or sampling thread.
pub const PLUGIN_ORDER: [&str; 6] = [
    "single-instance",
    "store",
    "opener",
    "global-shortcut",
    "autostart",
    "tray",
];
