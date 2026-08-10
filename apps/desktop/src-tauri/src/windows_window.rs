//! Win32 implementation of the overlay's window contract.
//!
//! `SetWindowPos` is intentionally used for a passive reveal rather than a
//! permanent `WS_EX_NOACTIVATE` style. That lets a user click or open Settings
//! and still type into the WebView, while passive hot-zone/tray reveals retain
//! the foreground application.

use crate::display_geometry::DisplayGeometry;
use crate::hot_zone::Rect;
use crate::platform_window::{ShowIntent, WindowPlacement};
use std::mem::size_of;
use tauri::WebviewWindow;
use windows_sys::Win32::Foundation::{POINT, RECT};
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, HMONITOR, MONITORINFO, MONITORINFOEXW,
    MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW,
};

pub fn prepare_overlay<R: tauri::Runtime>(_window: &WebviewWindow<R>) -> Result<(), String> {
    // Placement applies topmost state atomically. No persistent no-activate
    // extended style is installed, so a real click may focus the WebView.
    Ok(())
}

pub fn place_and_show<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    placement: WindowPlacement,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let mut flags = SWP_SHOWWINDOW;
    if placement.intent == ShowIntent::Passive {
        flags |= SWP_NOACTIVATE;
    }
    let placed = unsafe {
        SetWindowPos(
            hwnd.0,
            HWND_TOPMOST,
            placement.bounds.x.round() as i32,
            placement.bounds.y.round() as i32,
            placement.bounds.width.round().max(1.0) as i32,
            placement.bounds.height.round().max(1.0) as i32,
            flags,
        )
    };
    if placed == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if placement.intent == ShowIntent::Interactive {
        window.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Use Win32 physical coordinates so DPI conversion happens exactly once in
/// `DisplayGeometry::panel_bounds`. `rcWork` reserves taskbars and other app
/// bars; `rcMonitor` remains the source of truth for the outer-edge heat zone.
pub fn display_geometry<R: tauri::Runtime>(
    _window: &WebviewWindow<R>,
    fallback: Rect,
    scale_factor: f64,
) -> Result<DisplayGeometry, String> {
    let monitor = unsafe {
        MonitorFromPoint(
            POINT {
                x: fallback.x.round() as i32,
                y: fallback.y.round() as i32,
            },
            MONITOR_DEFAULTTONEAREST,
        )
    };
    if monitor.is_null() {
        return Ok(DisplayGeometry::new(
            fallback_stable_id(fallback),
            fallback,
            fallback,
            scale_factor,
            false,
        ));
    }

    let info = monitor_info(monitor)?;
    let monitor_bounds = rect_from_win32(info.monitorInfo.rcMonitor);
    let work_bounds = rect_from_win32(info.monitorInfo.rcWork);
    let right_taskbar = work_bounds.x + work_bounds.width < monitor_bounds.x + monitor_bounds.width;
    Ok(DisplayGeometry::new(
        stable_id_from_device(&info.szDevice).unwrap_or_else(|| fallback_stable_id(monitor_bounds)),
        monitor_bounds,
        work_bounds,
        scale_factor,
        right_taskbar,
    ))
}

/// Stable Windows device identity used for persisted monitor selection. This
/// MONITORINFOEX device name is the fallback when a stronger QueryDisplayConfig
/// topology hash is not available from the current WRY window handle.
pub fn stable_id_for_bounds(bounds: Rect) -> Option<String> {
    let monitor = unsafe {
        MonitorFromPoint(
            POINT {
                x: bounds.x.round() as i32,
                y: bounds.y.round() as i32,
            },
            MONITOR_DEFAULTTONEAREST,
        )
    };
    (!monitor.is_null())
        .then(|| {
            monitor_info(monitor)
                .ok()
                .and_then(|info| stable_id_from_device(&info.szDevice))
        })
        .flatten()
}

fn monitor_info(monitor: HMONITOR) -> Result<MONITORINFOEXW, String> {
    let mut info = MONITORINFOEXW {
        monitorInfo: MONITORINFO {
            cbSize: size_of::<MONITORINFOEXW>() as u32,
            rcMonitor: RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            rcWork: RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            dwFlags: 0,
        },
        szDevice: [0; 32],
    };
    if unsafe { GetMonitorInfoW(monitor, &mut info.monitorInfo) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(info)
}

fn rect_from_win32(value: RECT) -> Rect {
    Rect::new(
        value.left as f64,
        value.top as f64,
        (value.right - value.left).max(1) as f64,
        (value.bottom - value.top).max(1) as f64,
    )
}

/// MONITORINFOEX is the documented fallback identifier when a topology hash
/// is unavailable. It remains stable across a normal disconnect/reconnect;
/// the settings resolver falls back to the primary monitor when it changes.
fn stable_id_from_device(value: &[u16]) -> Option<String> {
    let length = value
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(value.len());
    (length > 0).then(|| format!("monitor:{}", String::from_utf16_lossy(&value[..length])))
}

// QueryDisplayConfig can supply a stronger topology hash in a future native
// refinement. This coordinate fallback avoids a panic on drivers that return
// an empty device name and deliberately degrades to the primary monitor.
fn fallback_stable_id(bounds: Rect) -> String {
    format!(
        "monitor:{:.0}:{:.0}:{:.0}:{:.0}",
        bounds.x, bounds.y, bounds.width, bounds.height
    )
}
