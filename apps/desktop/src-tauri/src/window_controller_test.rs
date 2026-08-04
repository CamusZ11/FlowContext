use super::hot_zone::{MonitorRect, Rect};
use super::window_controller::{WindowController, WindowControllerError, WindowPort};

#[derive(Default)]
struct FakeWindow {
    size: (f64, f64),
    position: (f64, f64),
    visible_state: bool,
    always_on_top: bool,
    overlay_prepared: bool,
    prepare_error: Option<String>,
    operations: Vec<&'static str>,
}

impl FakeWindow {
    fn new() -> Self {
        Self::default()
    }

    fn physical_size(&self) -> (f64, f64) {
        self.size
    }

    fn physical_position(&self) -> (f64, f64) {
        self.position
    }

    fn visible(&self) -> bool {
        self.visible_state
    }
}

impl WindowPort for FakeWindow {
    fn prepare_overlay(&mut self) -> Result<(), String> {
        self.operations.push("prepare_overlay");
        if let Some(error) = &self.prepare_error {
            return Err(error.clone());
        }
        self.overlay_prepared = true;
        Ok(())
    }

    fn set_physical_size(&mut self, width: f64, height: f64) -> Result<(), String> {
        self.operations.push("set_physical_size");
        self.size = (width, height);
        Ok(())
    }

    fn set_physical_position(&mut self, x: f64, y: f64) -> Result<(), String> {
        self.operations.push("set_physical_position");
        self.position = (x, y);
        Ok(())
    }

    fn set_always_on_top(&mut self, value: bool) -> Result<(), String> {
        self.operations.push("set_always_on_top");
        self.always_on_top = value;
        Ok(())
    }

    fn show(&mut self) -> Result<(), String> {
        self.operations.push("show");
        self.visible_state = true;
        Ok(())
    }

    fn hide(&mut self) -> Result<(), String> {
        self.operations.push("hide");
        self.visible_state = false;
        Ok(())
    }

    fn is_visible(&self) -> bool {
        self.visible_state
    }
}

fn monitor(x: f64, y: f64, width: f64, height: f64) -> MonitorRect {
    MonitorRect::new(x, y, width, height, 1.0)
}

#[test]
fn show_places_panel_at_selected_monitor_right_edge() {
    let mut window = FakeWindow::new();
    let controller = WindowController::new(420.0, 360.0, 560.0);
    controller
        .show(&mut window, monitor(0.0, 0.0, 1920.0, 1080.0))
        .unwrap();
    assert_eq!(window.physical_size(), (420.0, 1080.0));
    assert_eq!(window.physical_position(), (1500.0, 0.0));
    assert!(window.visible());
    assert!(window.always_on_top);
    assert!(window.overlay_prepared);
}

#[test]
fn show_reasserts_native_overlay_profile_immediately_before_ordering_front() {
    let mut window = FakeWindow::new();
    let controller = WindowController::new(420.0, 360.0, 560.0);

    controller
        .show(&mut window, monitor(0.0, 0.0, 1920.0, 1080.0))
        .unwrap();

    assert_eq!(
        window.operations,
        vec![
            "set_physical_size",
            "set_physical_position",
            "set_always_on_top",
            "prepare_overlay",
            "show",
        ]
    );
}

#[test]
fn show_stops_when_overlay_preparation_fails() {
    let mut window = FakeWindow {
        prepare_error: Some("native overlay unavailable".to_owned()),
        ..FakeWindow::new()
    };
    let controller = WindowController::new(420.0, 360.0, 560.0);

    let result = controller.show(&mut window, monitor(0.0, 0.0, 1920.0, 1080.0));

    assert_eq!(
        result,
        Err(WindowControllerError::Operation(
            "native overlay unavailable".to_owned()
        ))
    );
    assert_eq!(
        window.operations,
        vec![
            "set_physical_size",
            "set_physical_position",
            "set_always_on_top",
            "prepare_overlay",
        ]
    );
}

#[test]
fn show_clamps_saved_width_and_converts_dpi_coordinates() {
    let mut window = FakeWindow::new();
    let controller = WindowController::new(1000.0, 360.0, 560.0);
    controller
        .show(
            &mut window,
            MonitorRect::new(-2560.0, -100.0, 2560.0, 1440.0, 1.5),
        )
        .unwrap();
    assert_eq!(window.physical_size(), (840.0, 1440.0));
    assert_eq!(window.physical_position(), (-840.0, -100.0));
}

#[test]
fn hide_moves_panel_outside_edge_before_hiding() {
    let mut window = FakeWindow::new();
    let controller = WindowController::new(420.0, 360.0, 560.0);
    controller
        .show(&mut window, monitor(0.0, 0.0, 1920.0, 1080.0))
        .unwrap();
    controller
        .hide(&mut window, monitor(0.0, 0.0, 1920.0, 1080.0))
        .unwrap();
    assert_eq!(window.physical_position(), (1920.0, 0.0));
    assert!(!window.visible());
}

#[test]
fn toggle_uses_same_show_and_hide_paths() {
    let mut window = FakeWindow::new();
    let controller = WindowController::new(420.0, 360.0, 560.0);
    controller
        .toggle(&mut window, monitor(0.0, 0.0, 1920.0, 1080.0))
        .unwrap();
    assert!(window.visible());
    controller
        .toggle(&mut window, monitor(0.0, 0.0, 1920.0, 1080.0))
        .unwrap();
    assert!(!window.visible());
}

#[test]
fn rect_keeps_expected_window_bounds() {
    let bounds = Rect::new(1500.0, 0.0, 420.0, 1080.0);
    assert!(bounds.contains(super::hot_zone::Point { x: 1500.0, y: 0.0 }));
}
