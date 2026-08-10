use super::display_geometry::DisplayGeometry;
use super::hot_zone::Rect;

fn geometry(x: f64, y: f64, scale: f64) -> DisplayGeometry {
    DisplayGeometry::new(
        "query-display-config-hash",
        Rect::new(x, y, 2560.0, 1440.0),
        Rect::new(x, y + 40.0, 2560.0, 1400.0),
        scale,
        false,
    )
}

#[test]
fn attaches_to_work_area_once_at_100_and_150_percent() {
    let at_100 = geometry(0.0, 0.0, 1.0).panel_bounds(420.0);
    assert_eq!(at_100, Rect::new(2140.0, 40.0, 420.0, 1400.0));

    let at_150 = geometry(-2560.0, -300.0, 1.5).panel_bounds(420.0);
    assert_eq!(at_150, Rect::new(-630.0, -260.0, 630.0, 1400.0));
}

#[test]
fn taskbar_disables_hot_zone_but_not_panel_geometry() {
    let display = DisplayGeometry::new(
        "monitor-id",
        Rect::new(0.0, 0.0, 1920.0, 1080.0),
        Rect::new(0.0, 0.0, 1880.0, 1080.0),
        1.0,
        true,
    );
    assert!(!display.hot_zone_enabled());
    assert!(display.hot_zone_disabled_reason().is_some());
    assert_eq!(display.panel_bounds(420.0).x, 1460.0);
}
