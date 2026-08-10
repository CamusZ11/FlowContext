use super::display_geometry::DisplayGeometry;
use super::hot_zone::Rect;
use super::platform_window::{ShowIntent, WindowPlacement};
use super::window_controller::{WindowController, WindowControllerError, WindowPort};

#[derive(Default)]
struct FakeWindow {
    placement: Option<WindowPlacement>,
    hidden_at: Option<(f64, f64)>,
    visible_state: bool,
    prepare_error: Option<String>,
    operations: Vec<&'static str>,
}

impl FakeWindow {
    fn new() -> Self {
        Self::default()
    }
}

impl WindowPort for FakeWindow {
    fn prepare_overlay(&mut self) -> Result<(), String> {
        self.operations.push("prepare_overlay");
        if let Some(error) = &self.prepare_error {
            return Err(error.clone());
        }
        Ok(())
    }

    fn place_and_show(&mut self, placement: WindowPlacement) -> Result<(), String> {
        self.operations.push("place_and_show");
        self.placement = Some(placement);
        self.visible_state = true;
        Ok(())
    }

    fn hide_at(&mut self, x: f64, y: f64) -> Result<(), String> {
        self.operations.push("hide_at");
        self.hidden_at = Some((x, y));
        self.visible_state = false;
        Ok(())
    }

    fn is_visible(&self) -> bool {
        self.visible_state
    }
}

fn display(x: f64, y: f64, scale: f64) -> DisplayGeometry {
    DisplayGeometry::new(
        "display",
        Rect::new(x, y, 2560.0, 1440.0),
        Rect::new(x, y + 40.0, 2560.0, 1400.0),
        scale,
        false,
    )
}

#[test]
fn passive_show_uses_one_atomic_physical_placement_at_the_work_area_right_edge() {
    let mut window = FakeWindow::new();
    let controller = WindowController::new(420.0, 360.0, 560.0);
    controller
        .show(&mut window, &display(-2560.0, -300.0, 1.5))
        .unwrap();

    assert_eq!(
        window.placement,
        Some(WindowPlacement::new(
            Rect::new(-630.0, -260.0, 630.0, 1400.0),
            ShowIntent::Passive,
        )),
    );
    assert_eq!(window.operations, ["prepare_overlay", "place_and_show"]);
}

#[test]
fn interactive_show_is_explicit_and_never_a_persistent_no_activate_state() {
    let mut window = FakeWindow::new();
    let controller = WindowController::new(420.0, 360.0, 560.0);
    controller
        .show_with_intent(
            &mut window,
            &display(0.0, 0.0, 1.0),
            ShowIntent::Interactive,
        )
        .unwrap();
    assert_eq!(window.placement.unwrap().intent, ShowIntent::Interactive);
}

#[test]
fn show_stops_when_overlay_preparation_fails() {
    let mut window = FakeWindow {
        prepare_error: Some("native overlay unavailable".to_owned()),
        ..FakeWindow::new()
    };
    let controller = WindowController::new(420.0, 360.0, 560.0);
    let result = controller.show(&mut window, &display(0.0, 0.0, 1.0));

    assert_eq!(
        result,
        Err(WindowControllerError::Operation(
            "native overlay unavailable".to_owned()
        ))
    );
    assert_eq!(window.operations, ["prepare_overlay"]);
}

#[test]
fn hide_moves_to_the_monitor_outer_edge_before_hiding() {
    let mut window = FakeWindow::new();
    let controller = WindowController::new(420.0, 360.0, 560.0);
    let selected = display(-2560.0, -300.0, 1.5);
    controller.show(&mut window, &selected).unwrap();
    controller.hide(&mut window, &selected).unwrap();
    assert_eq!(window.hidden_at, Some((0.0, -300.0)));
    assert!(!window.visible_state);
}
