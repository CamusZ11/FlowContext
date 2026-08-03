#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

#[cfg(target_os = "macos")]
pub fn fullscreen_overlay_behavior(
    current: NSWindowCollectionBehavior,
) -> NSWindowCollectionBehavior {
    current
        | NSWindowCollectionBehavior::CanJoinAllSpaces
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

#[cfg(not(target_os = "macos"))]
pub fn prepare_fullscreen_overlay<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    Ok(())
}
