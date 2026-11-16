use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const LABEL: &str = "todo-week";
const DATE_EVENT: &str = "flowcontext:todo-week-date";

#[derive(Default)]
pub(crate) struct WeekWindowState {
    opening: tauri::async_runtime::Mutex<()>,
    ready: AtomicBool,
    pending_date: Mutex<Option<String>>,
}

#[tauri::command]
pub(crate) async fn open_todo_week(
    window: WebviewWindow,
    state: tauri::State<'_, WeekWindowState>,
    date: String,
) -> Result<(), String> {
    if window.label() != "main"
        || date.len() != 10
        || !chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
            .is_ok_and(|value| value.format("%Y-%m-%d").to_string() == date)
    {
        return Err("无效的周视图日期".into());
    }
    let _opening = state.opening.lock().await;
    let app = window.app_handle();
    if let Some(week) = app.get_webview_window(LABEL) {
        *state.pending_date.lock().unwrap() = Some(date);
        week.unminimize()
            .and_then(|_| week.show())
            .and_then(|_| week.set_focus())
            .map_err(|error| error.to_string())?;
        if state.ready.load(Ordering::Relaxed) {
            apply_pending_date(&week, &state)?;
            let _ = window.hide();
        }
        return Ok(());
    }

    state.ready.store(false, Ordering::Relaxed);
    *state.pending_date.lock().unwrap() = None;
    let (width, height) =
        window
            .current_monitor()
            .ok()
            .flatten()
            .map_or((1160.0, 820.0), |monitor| {
                let scale = monitor.scale_factor();
                (
                    (f64::from(monitor.size().width) / scale * 0.9).min(1240.0),
                    (f64::from(monitor.size().height) / scale * 0.86).min(900.0),
                )
            });
    let week = WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App(format!("index.html?date={date}#todo-week").into()),
    )
    .title("周视图 · FlowContext")
    .inner_size(width, height)
    .min_inner_size(480.0, 360.0)
    .center()
    .on_navigation(|url| match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost")) => true,
        ("http", Some("localhost")) => cfg!(debug_assertions) && url.port() == Some(5173),
        _ => false,
    })
    .build()
    .map_err(|error| error.to_string())?;

    let handle = app.clone();
    week.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed)
            && handle
                .state::<WeekWindowState>()
                .ready
                .swap(false, Ordering::Relaxed)
        {
            if let Some(main) = handle.get_webview_window("main") {
                let settings = crate::settings::load(&handle).unwrap_or_default();
                let _ = crate::runtime::show_panel(main, settings);
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn todo_week_ready(
    window: WebviewWindow,
    state: tauri::State<'_, WeekWindowState>,
) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("周视图窗口不可用".into());
    }
    state.ready.store(true, Ordering::Relaxed);
    apply_pending_date(&window, &state)?;
    if let Some(main) = window.app_handle().get_webview_window("main") {
        let _ = main.hide();
    }
    Ok(())
}

fn apply_pending_date(window: &WebviewWindow, state: &WeekWindowState) -> Result<(), String> {
    let mut pending = state.pending_date.lock().unwrap();
    if let Some(date) = pending.as_ref() {
        window
            .emit_to(LABEL, DATE_EVENT, date)
            .map_err(|error| error.to_string())?;
        pending.take();
    }
    Ok(())
}
