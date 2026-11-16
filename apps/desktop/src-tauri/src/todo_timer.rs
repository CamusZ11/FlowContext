use serde::{Deserialize, Serialize};
use std::{
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{
    Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const LABEL: &str = "todo-timer";
const TASK_EVENT: &str = "flowcontext:todo-timer-task";
const WIDTH: f64 = 268.0;
const HEIGHT: f64 = 52.0;

#[derive(Default)]
pub(crate) struct TimerWindowState {
    lifecycle: tauri::async_runtime::Mutex<()>,
    destroyed: Mutex<Option<mpsc::SyncSender<()>>>,
    task: Mutex<Option<ActiveTask>>,
}

#[derive(Deserialize)]
pub(crate) struct TimerTask {
    id: String,
    title: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct ActiveTask {
    id: String,
    title: String,
    revision: u64,
}

#[tauri::command]
pub(crate) async fn start_todo_timer(
    window: WebviewWindow,
    state: tauri::State<'_, TimerWindowState>,
    task: TimerTask,
) -> Result<(), String> {
    if !matches!(window.label(), "main" | "todo-week")
        || task.id.trim().is_empty()
        || task.title.trim().is_empty()
    {
        return Err("计时窗口不可用".into());
    }
    let _lifecycle = state.lifecycle.lock().await;
    let app = window.app_handle();
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "没有可用的显示器".to_owned())?;

    let existing = app.get_webview_window(LABEL);
    let active = {
        let mut current = state.task.lock().unwrap();
        let revision = if existing.is_some() {
            current.as_ref().map_or(0, |previous| {
                previous.revision + u64::from(previous.id != task.id)
            })
        } else {
            0
        };
        let active = ActiveTask {
            id: task.id,
            title: task.title.chars().take(200).collect(),
            revision,
        };
        *current = Some(active.clone());
        active
    };
    let timer = if let Some(existing) = existing {
        existing
    } else {
        WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#todo-timer".into()))
            .title("任务计时 · FlowContext")
            .inner_size(WIDTH, HEIGHT)
            .position(-10000.0, -10000.0)
            .visible(true)
            .focused(false)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .transparent(true)
            .shadow(false)
            .accept_first_mouse(true)
            .build()
            .map_err(|error| error.to_string())?
    };

    let (send, mut receive) = tauri::async_runtime::channel(1);
    let presenting = timer.clone();
    app.run_on_main_thread(move || {
        let _ = send.try_send(place_and_show(&presenting, &monitor));
    })
    .map_err(|error| error.to_string())?;
    let result = receive
        .recv()
        .await
        .ok_or_else(|| "计时窗口不可用".to_owned())?;
    if result.is_err() {
        let _ = destroy_timer(&timer, &state).await;
    }
    result?;
    timer
        .emit_to(LABEL, TASK_EVENT, active)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn read_todo_timer_task(
    window: WebviewWindow,
    state: tauri::State<'_, TimerWindowState>,
) -> Option<ActiveTask> {
    if window.label() != LABEL {
        return None;
    }
    state.task.lock().unwrap().clone()
}

fn place_and_show(window: &WebviewWindow, monitor: &tauri::Monitor) -> Result<(), String> {
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let x =
        f64::from(monitor.position().x) + (f64::from(monitor.size().width) - WIDTH * scale) / 2.0;
    let y = f64::from(work.position.y) + 8.0 * scale;

    #[cfg(target_os = "macos")]
    let position = tauri::Position::Logical(tauri::LogicalPosition::new(x / scale, y / scale));
    #[cfg(not(target_os = "macos"))]
    let position = tauri::Position::Physical(tauri::PhysicalPosition::new(
        x.round() as i32,
        y.round() as i32,
    ));
    window
        .set_position(position)
        .map_err(|error| error.to_string())?;
    crate::macos_window::prepare_fullscreen_overlay(window)?;
    crate::macos_window::show_fullscreen_overlay(window)
}

#[tauri::command]
pub(crate) async fn close_todo_timer(
    window: WebviewWindow,
    state: tauri::State<'_, TimerWindowState>,
) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("计时窗口不可用".into());
    }
    let _lifecycle = state.lifecycle.lock().await;
    destroy_timer(&window, &state).await
}

async fn destroy_timer(window: &WebviewWindow, state: &TimerWindowState) -> Result<(), String> {
    let (send, receive) = mpsc::sync_channel(1);
    *state.destroyed.lock().unwrap() = Some(send);
    let result = match window.destroy() {
        Ok(()) => tauri::async_runtime::spawn_blocking(move || {
            receive.recv_timeout(Duration::from_secs(2))
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string()),
        Err(error) => Err(error.to_string()),
    };
    state.destroyed.lock().unwrap().take();
    result
}

pub(crate) fn handle_event(app: &tauri::AppHandle, event: RunEvent) {
    if let RunEvent::WindowEvent {
        label,
        event: WindowEvent::Destroyed,
        ..
    } = event
    {
        // Tauri has already removed the window's label when this callback runs.
        if label == LABEL {
            let state = app.state::<TimerWindowState>();
            state.task.lock().unwrap().take();
            let pending_close = state.destroyed.lock().unwrap().take();
            if let Some(send) = pending_close {
                let _ = send.try_send(());
            }
        }
    }
}
