use super::hot_zone::{Action, HotZoneEngine, MonitorRect, Point, Rect, WindowState};

fn point(x: f64, y: f64) -> Point {
    Point { x, y }
}

fn monitor() -> MonitorRect {
    MonitorRect::new(0.0, 0.0, 1920.0, 1080.0, 1.0)
}

fn hidden() -> WindowState {
    WindowState::hidden()
}

fn visible_window() -> WindowState {
    WindowState::visible(Rect::new(1500.0, 0.0, 420.0, 1080.0))
}

fn visible_engine() -> HotZoneEngine {
    HotZoneEngine::new(2.0, 150, 0)
}

#[test]
fn shows_only_after_150_ms_inside_two_pixel_edge() {
    let mut engine = HotZoneEngine::new(2.0, 150, 0);
    assert_eq!(
        engine.sample(0, point(1919.0, 500.0), monitor(), hidden()),
        vec![]
    );
    assert_eq!(
        engine.sample(149, point(1919.0, 500.0), monitor(), hidden()),
        vec![]
    );
    assert_eq!(
        engine.sample(150, point(1919.0, 500.0), monitor(), hidden()),
        vec![Action::Show]
    );
}

#[test]
fn hides_on_the_first_sample_after_cursor_leaves_window() {
    let mut engine = visible_engine();
    assert_eq!(
        engine.sample(0, point(1800.0, 500.0), monitor(), visible_window()),
        vec![]
    );
    assert_eq!(
        engine.sample(1, point(100.0, 100.0), monitor(), visible_window()),
        vec![Action::Hide]
    );
    assert_eq!(
        engine.sample(2, point(100.0, 100.0), monitor(), visible_window()),
        vec![]
    );
}

#[test]
fn returning_inside_window_cancels_pending_hide_before_exit_sample() {
    let mut engine = visible_engine();
    assert_eq!(
        engine.sample(0, point(1800.0, 500.0), monitor(), visible_window()),
        vec![]
    );
    assert_eq!(
        engine.sample(1, point(100.0, 100.0), monitor(), visible_window()),
        vec![Action::Hide]
    );
    assert_eq!(
        engine.sample(2, point(1800.0, 500.0), monitor(), visible_window()),
        vec![]
    );
}

#[test]
fn leaving_hot_zone_before_150_ms_resets_entry_timer() {
    let mut engine = HotZoneEngine::new(2.0, 150, 0);
    assert_eq!(
        engine.sample(0, point(1919.0, 500.0), monitor(), hidden()),
        vec![]
    );
    assert_eq!(
        engine.sample(149, point(1900.0, 500.0), monitor(), hidden()),
        vec![]
    );
    assert_eq!(
        engine.sample(299, point(1919.0, 500.0), monitor(), hidden()),
        vec![]
    );
    assert_eq!(
        engine.sample(448, point(1919.0, 500.0), monitor(), hidden()),
        vec![]
    );
    assert_eq!(
        engine.sample(449, point(1919.0, 500.0), monitor(), hidden()),
        vec![Action::Show]
    );
}

#[test]
fn supports_negative_coordinate_monitors_and_dpi() {
    let monitor = MonitorRect::new(-2560.0, -100.0, 2560.0, 1440.0, 1.5);
    let mut engine = HotZoneEngine::new(2.0, 150, 0);
    assert_eq!(
        engine.sample(0, point(-1.0, 500.0), monitor.clone(), hidden()),
        vec![]
    );
    assert_eq!(
        engine.sample(150, point(-1.0, 500.0), monitor, hidden()),
        vec![Action::Show]
    );
}

#[test]
fn ignores_duplicate_actions_while_window_is_animating() {
    let mut engine = HotZoneEngine::new(2.0, 150, 0);
    assert_eq!(
        engine.sample(0, point(1919.0, 500.0), monitor(), hidden()),
        vec![]
    );
    assert_eq!(
        engine.sample(150, point(1919.0, 500.0), monitor(), hidden()),
        vec![Action::Show]
    );
    assert_eq!(
        engine.sample(
            300,
            point(1919.0, 500.0),
            monitor(),
            WindowState::hidden_animating()
        ),
        vec![]
    );

    let mut visible = HotZoneEngine::new(2.0, 150, 0);
    assert_eq!(
        visible.sample(0, point(1800.0, 500.0), monitor(), visible_window()),
        vec![]
    );
    assert_eq!(
        visible.sample(1, point(100.0, 100.0), monitor(), visible_window()),
        vec![Action::Hide]
    );
    assert_eq!(
        visible.sample(
            500,
            point(100.0, 100.0),
            monitor(),
            WindowState::visible_animating(Rect::new(1500.0, 0.0, 420.0, 1080.0))
        ),
        vec![]
    );
}

#[test]
fn manual_show_after_previous_hide_can_hide_again_outside_panel() {
    let mut engine = HotZoneEngine::new(2.0, 150, 0);
    assert_eq!(
        engine.sample(0, point(1800.0, 500.0), monitor(), visible_window()),
        vec![]
    );
    assert_eq!(
        engine.sample(1, point(100.0, 100.0), monitor(), visible_window()),
        vec![Action::Hide]
    );
    assert_eq!(
        engine.sample(2, point(100.0, 100.0), monitor(), hidden()),
        vec![]
    );
    assert_eq!(
        engine.sample(3, point(100.0, 100.0), monitor(), visible_window()),
        vec![Action::Hide]
    );
}
