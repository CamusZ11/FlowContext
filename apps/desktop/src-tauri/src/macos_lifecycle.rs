use block2::RcBlock;
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceScreensDidWakeNotification,
};
use std::ptr::NonNull;
use tauri::Manager;

/// Subscribe to system and display wake notifications for the lifetime of the
/// process. The opaque observer tokens are retained until process exit.
pub fn install_wake_recovery(app: tauri::AppHandle) -> Result<(), String> {
    let workspace = NSWorkspace::sharedWorkspace();
    let notification_center = workspace.notificationCenter();
    unsafe {
        register_wake_observer(
            &notification_center,
            &NSWorkspaceDidWakeNotification,
            app.clone(),
        );
        register_wake_observer(
            &notification_center,
            &NSWorkspaceScreensDidWakeNotification,
            app,
        );
    }
    Ok(())
}

fn register_wake_observer(
    notification_center: &objc2_foundation::NSNotificationCenter,
    notification: &objc2_foundation::NSNotificationName,
    app: tauri::AppHandle,
) {
    let callback = RcBlock::new(move |_notification: NonNull<_>| {
        let app = app.clone();
        let recovery_app = app.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(window) = recovery_app.get_webview_window("main") else {
                return;
            };
            let settings = recovery_app
                .state::<crate::settings::DeviceSettingsState>()
                .inner()
                .clone();
            let sampling = recovery_app.state::<crate::DesktopRuntimeState>();
            if let Err(error) =
                crate::runtime::restart_sampling_after_wake(window, settings, &sampling.0)
            {
                eprintln!("FlowContext wake recovery failed: {error}");
            }
        });
    });
    let observer = unsafe {
        notification_center.addObserverForName_object_queue_usingBlock(
            Some(notification),
            None,
            None,
            &callback,
        )
    };
    std::mem::forget(observer);
}
