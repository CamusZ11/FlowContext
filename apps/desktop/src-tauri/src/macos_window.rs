#[cfg(target_os = "macos")]
use objc2::{ClassType, Message};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSApplication, NSPanel, NSScreen, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{MainThreadMarker, NSObjectProtocol};
#[cfg(target_os = "macos")]
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_nspanel::{panel, ManagerExt, PanelHandle, PanelLevel, StyleMask, WebviewWindowExt};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverlayOrdering {
    OrderFrontRegardless,
    OrderOut,
}

pub const fn fullscreen_overlay_ordering() -> [OverlayOrdering; 2] {
    [
        OverlayOrdering::OrderFrontRegardless,
        OverlayOrdering::OrderOut,
    ]
}

#[cfg(target_os = "macos")]
fn application_role_mask() -> NSWindowCollectionBehavior {
    NSWindowCollectionBehavior::Primary
        | NSWindowCollectionBehavior::Auxiliary
        | NSWindowCollectionBehavior::CanJoinAllApplications
}

#[cfg(target_os = "macos")]
fn mission_control_role_mask() -> NSWindowCollectionBehavior {
    NSWindowCollectionBehavior::Managed
        | NSWindowCollectionBehavior::Transient
        | NSWindowCollectionBehavior::Stationary
}

#[cfg(target_os = "macos")]
fn fullscreen_role_mask() -> NSWindowCollectionBehavior {
    NSWindowCollectionBehavior::FullScreenPrimary
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::FullScreenNone
}

#[cfg(target_os = "macos")]
fn required_fullscreen_overlay_behavior() -> NSWindowCollectionBehavior {
    NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::CanJoinAllApplications
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::Stationary
}

#[cfg(target_os = "macos")]
pub fn fullscreen_overlay_behavior(
    current: NSWindowCollectionBehavior,
) -> NSWindowCollectionBehavior {
    current
        .difference(application_role_mask())
        .difference(mission_control_role_mask())
        .difference(fullscreen_role_mask())
        .difference(NSWindowCollectionBehavior::MoveToActiveSpace)
        .union(required_fullscreen_overlay_behavior())
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FullscreenOverlayPanelProfile {
    pub nonactivating: bool,
    pub transparent: bool,
    pub floating: bool,
    pub hides_on_deactivate: bool,
    pub becomes_key_only_if_needed: bool,
    pub level: i64,
    pub collection_behavior: NSWindowCollectionBehavior,
}

#[cfg(target_os = "macos")]
pub fn fullscreen_overlay_panel_profile() -> FullscreenOverlayPanelProfile {
    FullscreenOverlayPanelProfile {
        nonactivating: true,
        transparent: true,
        floating: true,
        hides_on_deactivate: false,
        becomes_key_only_if_needed: true,
        level: PanelLevel::ScreenSaver.value(),
        collection_behavior: fullscreen_overlay_behavior(NSWindowCollectionBehavior::empty()),
    }
}

#[cfg(target_os = "macos")]
panel!(FlowContextPanel {
    config: {
        can_become_key_window: true,
        can_become_main_window: false,
        is_floating_panel: true,
    }
});

#[cfg(target_os = "macos")]
#[derive(Debug)]
pub struct NativeOverlaySnapshot {
    pub native_class: String,
    pub is_panel: bool,
    pub opaque: bool,
    pub collection_behavior_bits: usize,
    pub level: isize,
    pub visible: bool,
    pub on_active_space: bool,
    pub key_window: bool,
    pub main_window: bool,
    pub app_active: bool,
    pub app_hidden: bool,
    pub frame: (f64, f64, f64, f64),
    pub screen_number: Option<u32>,
    pub screens_have_separate_spaces: bool,
}

#[cfg(target_os = "macos")]
fn overlay_diagnostics_enabled() -> bool {
    std::env::var_os("FLOWCONTEXT_OVERLAY_DIAGNOSTICS")
        .as_deref()
        .is_some_and(|value| value == "1")
}

#[cfg(target_os = "macos")]
fn require_main_thread() -> Result<(), String> {
    MainThreadMarker::new()
        .map(|_| ())
        .ok_or_else(|| "macOS overlay operation requires the main thread".to_owned())
}

#[cfg(target_os = "macos")]
fn snapshot_fullscreen_overlay<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<NativeOverlaySnapshot, String> {
    let marker = MainThreadMarker::new()
        .ok_or_else(|| "macOS overlay snapshot requires the main thread".to_owned())?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    unsafe {
        let native: &NSWindow = &*pointer.cast();
        let frame = native.frame();
        let app = NSApplication::sharedApplication(marker);
        Ok(NativeOverlaySnapshot {
            native_class: native.class().name().to_string_lossy().into_owned(),
            is_panel: native.isKindOfClass(NSPanel::class()),
            opaque: native.isOpaque(),
            collection_behavior_bits: native.collectionBehavior().bits(),
            level: native.level(),
            visible: native.isVisible(),
            on_active_space: native.isOnActiveSpace(),
            key_window: native.isKeyWindow(),
            main_window: native.isMainWindow(),
            app_active: app.isActive(),
            app_hidden: app.isHidden(),
            frame: (
                frame.origin.x,
                frame.origin.y,
                frame.size.width,
                frame.size.height,
            ),
            screen_number: native
                .screen()
                .map(|screen| screen.CGDirectDisplayID() as u32),
            screens_have_separate_spaces: NSScreen::screensHaveSeparateSpaces(marker),
        })
    }
}

#[cfg(target_os = "macos")]
fn log_overlay_snapshot<R: tauri::Runtime>(stage: &str, window: &tauri::WebviewWindow<R>) {
    if !overlay_diagnostics_enabled() {
        return;
    }

    match snapshot_fullscreen_overlay(window) {
        Ok(snapshot) => eprintln!("FlowContext overlay snapshot {stage}: {snapshot:?}"),
        Err(error) => eprintln!("FlowContext overlay snapshot {stage} failed: {error}"),
    }
}

#[cfg(target_os = "macos")]
fn configure_fullscreen_overlay_panel<R: tauri::Runtime>(
    panel: &PanelHandle<R>,
) -> Result<(), String> {
    require_main_thread()?;
    let profile = fullscreen_overlay_panel_profile();
    panel.set_style_mask(
        StyleMask::new()
            .borderless()
            .resizable()
            .nonactivating_panel()
            .into(),
    );
    panel.set_transparent(profile.transparent);
    panel.set_has_shadow(false);
    panel.set_floating_panel(profile.floating);
    panel.set_hides_on_deactivate(profile.hides_on_deactivate);
    panel.set_becomes_key_only_if_needed(profile.becomes_key_only_if_needed);
    panel.set_level(profile.level);
    panel.set_collection_behavior(profile.collection_behavior);
    validate_fullscreen_overlay_panel(panel)
}

#[cfg(target_os = "macos")]
fn validate_fullscreen_overlay_panel<R: tauri::Runtime>(
    panel: &PanelHandle<R>,
) -> Result<(), String> {
    let profile = fullscreen_overlay_panel_profile();
    let native = panel.as_panel();
    let behavior = native.collectionBehavior();
    if !native.isKindOfClass(NSPanel::class()) {
        return Err("FlowContext overlay is not an NSPanel after conversion".to_owned());
    }
    if profile.transparent && native.isOpaque() {
        return Err("FlowContext overlay remains opaque after NSPanel conversion".to_owned());
    }
    if !native
        .styleMask()
        .contains(NSWindowStyleMask::NonactivatingPanel)
    {
        return Err("FlowContext overlay is missing the nonactivating panel style".to_owned());
    }
    if !native.isFloatingPanel() {
        return Err("FlowContext overlay is not a floating panel".to_owned());
    }
    if native.hidesOnDeactivate() {
        return Err("FlowContext overlay hides when its app deactivates".to_owned());
    }
    if !native.becomesKeyOnlyIfNeeded() {
        return Err("FlowContext overlay does not defer key-window status until needed".to_owned());
    }
    if native.level() != profile.level as isize {
        return Err(format!(
            "FlowContext overlay level is {}, expected {}",
            native.level(),
            profile.level
        ));
    }
    if behavior != fullscreen_overlay_behavior(behavior) {
        return Err("FlowContext overlay has conflicting collection behavior roles".to_owned());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn install_fullscreen_overlay_panel<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    require_main_thread()?;
    let panel = window
        .to_panel::<FlowContextPanel<R>>()
        .map_err(|error| error.to_string())?;
    configure_fullscreen_overlay_panel(&panel)?;
    log_overlay_snapshot("setup-after-panel-install", window);
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn prepare_fullscreen_overlay<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    require_main_thread()?;
    let panel = window
        .app_handle()
        .get_webview_panel(window.label())
        .map_err(|error| format!("FlowContext overlay panel unavailable: {error:?}"))?;
    configure_fullscreen_overlay_panel(&panel)?;
    log_overlay_snapshot("setup-after-prepare", window);
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn show_fullscreen_overlay<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    require_main_thread()?;
    log_overlay_snapshot("show-before-order", window);
    let panel = window
        .app_handle()
        .get_webview_panel(window.label())
        .map_err(|error| format!("FlowContext overlay panel unavailable: {error:?}"))?;
    panel.order_front_regardless();
    log_overlay_snapshot("show-after-order", window);
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn hide_fullscreen_overlay<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    require_main_thread()?;
    let panel = window
        .app_handle()
        .get_webview_panel(window.label())
        .map_err(|error| format!("FlowContext overlay panel unavailable: {error:?}"))?;
    panel.hide();
    log_overlay_snapshot("hide-after-order-out", window);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn prepare_fullscreen_overlay<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn show_fullscreen_overlay<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn hide_fullscreen_overlay<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}
