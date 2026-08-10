use crate::display_geometry::DisplayGeometry;
use crate::hot_zone::Rect;

/// Whether a caller is merely revealing the overlay or explicitly requesting
/// keyboard input. Passive reveals must not steal focus from the foreground
/// application; an interactive request (for example the Settings tray item)
/// may acquire it afterwards.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShowIntent {
    Passive,
    Interactive,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindowPlacement {
    pub bounds: Rect,
    pub intent: ShowIntent,
}

impl WindowPlacement {
    pub const fn new(bounds: Rect, intent: ShowIntent) -> Self {
        Self { bounds, intent }
    }
}

/// Platform-specific monitor/work-area lookup. The fallback is deliberately
/// kept for macOS and unsupported targets; Windows replaces it with Win32
/// monitor work-area data before a placement is calculated.
pub fn display_geometry<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    fallback: Rect,
    scale_factor: f64,
) -> Result<DisplayGeometry, String> {
    #[cfg(target_os = "windows")]
    {
        return crate::windows_window::display_geometry(window, fallback, scale_factor);
    }

    #[cfg(target_os = "macos")]
    {
        let inset = 28.0 * scale_factor.max(1.0);
        return Ok(DisplayGeometry::new(
            "macos-monitor",
            fallback,
            Rect::new(
                fallback.x,
                fallback.y + inset,
                fallback.width,
                (fallback.height - inset).max(1.0),
            ),
            scale_factor,
            false,
        ));
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = window;
        Ok(DisplayGeometry::new(
            "unsupported-monitor",
            fallback,
            fallback,
            scale_factor,
            false,
        ))
    }
}

pub fn prepare_overlay<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return crate::macos_window::prepare_fullscreen_overlay(window);
    }

    #[cfg(target_os = "windows")]
    {
        return crate::windows_window::prepare_overlay(window);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
        Ok(())
    }
}

pub fn place_and_show<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    placement: WindowPlacement,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return crate::windows_window::place_and_show(window, placement);
    }

    #[cfg(target_os = "macos")]
    {
        window
            .set_size(tauri::PhysicalSize::new(
                placement.bounds.width.round().max(1.0) as u32,
                placement.bounds.height.round().max(1.0) as u32,
            ))
            .and_then(|_| {
                window.set_position(tauri::PhysicalPosition::new(
                    placement.bounds.x.round() as i32,
                    placement.bounds.y.round() as i32,
                ))
            })
            .and_then(|_| window.set_always_on_top(true))
            .map_err(|error| error.to_string())?;
        crate::macos_window::show_fullscreen_overlay(window)?;
        if placement.intent == ShowIntent::Interactive {
            window.set_focus().map_err(|error| error.to_string())?;
        }
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        window
            .set_size(tauri::PhysicalSize::new(
                placement.bounds.width.round().max(1.0) as u32,
                placement.bounds.height.round().max(1.0) as u32,
            ))
            .and_then(|_| {
                window.set_position(tauri::PhysicalPosition::new(
                    placement.bounds.x.round() as i32,
                    placement.bounds.y.round() as i32,
                ))
            })
            .and_then(|_| window.set_always_on_top(true))
            .and_then(|_| window.show())
            .map_err(|error| error.to_string())?;
        if placement.intent == ShowIntent::Interactive {
            window.set_focus().map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

pub fn hide<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    x: f64,
    y: f64,
) -> Result<(), String> {
    window
        .set_position(tauri::PhysicalPosition::new(
            x.round() as i32,
            y.round() as i32,
        ))
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    {
        return crate::macos_window::hide_fullscreen_overlay(window);
    }

    #[cfg(not(target_os = "macos"))]
    {
        window.hide().map_err(|error| error.to_string())
    }
}
