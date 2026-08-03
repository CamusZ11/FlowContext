#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverlayOrdering {
    OrderFrontRegardless,
    OrderOut,
}

pub const fn fullscreen_overlay_ordering() -> [OverlayOrdering; 2] {
    [OverlayOrdering::OrderFrontRegardless, OverlayOrdering::OrderOut]
}

#[cfg(target_os = "macos")]
pub fn fullscreen_overlay_behavior(
    current: NSWindowCollectionBehavior,
) -> NSWindowCollectionBehavior {
    current
        | NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::CanJoinAllApplications
        | NSWindowCollectionBehavior::FullScreenAuxiliary
}

#[cfg(target_os = "macos")]
pub fn prepare_fullscreen_overlay<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    window
        .set_visible_on_all_workspaces(true)
        .map_err(|error| error.to_string())?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    unsafe {
        let native: &NSWindow = &*pointer.cast();
        native.setCollectionBehavior(fullscreen_overlay_behavior(native.collectionBehavior()));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn show_fullscreen_overlay<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    unsafe {
        let native: &NSWindow = &*pointer.cast();
        native.orderFrontRegardless();
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn hide_fullscreen_overlay<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    unsafe {
        let native: &NSWindow = &*pointer.cast();
        native.orderOut(None);
    }
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
