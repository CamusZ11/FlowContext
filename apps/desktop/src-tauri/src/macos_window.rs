#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

/// Collection behavior for the overlay window: visible on every Space and
/// allowed to sit above fullscreen apps as an auxiliary window. This is the
/// plain-NSWindow behavior that was verified to show reliably on a normal
/// desktop; the earlier NSPanel conversion regressed tray/shortcut/hot-zone
/// showing and is intentionally reverted until fullscreen Spaces are tackled.
#[cfg(target_os = "macos")]
pub fn fullscreen_overlay_behavior(
    current: NSWindowCollectionBehavior,
) -> NSWindowCollectionBehavior {
    current
        .difference(
            NSWindowCollectionBehavior::Primary
                | NSWindowCollectionBehavior::Auxiliary
                | NSWindowCollectionBehavior::CanJoinAllApplications,
        )
        .difference(
            NSWindowCollectionBehavior::FullScreenPrimary
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::FullScreenNone,
        )
        .difference(
            NSWindowCollectionBehavior::Managed
                | NSWindowCollectionBehavior::Transient
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::MoveToActiveSpace,
        )
        | NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::CanJoinAllApplications
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::Stationary
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
    // `window.show()` updates Tauri's visibility state. Fullscreen Spaces
    // also need the native window ordered above the fullscreen application's
    // surface; doing that on the existing NSWindow avoids the NSPanel
    // conversion that made ordinary hot-zone reveals disappear.
    window.show().map_err(|error| error.to_string())?;
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
    window.hide().map_err(|error| error.to_string())
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
