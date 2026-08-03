use super::hot_zone::MonitorRect;
use super::monitor::{
    external_right_segments, monitor_options, resolve_selected_monitor, MonitorDescriptor,
};

fn rect(id: &str, x: f64, y: f64, width: f64, height: f64) -> MonitorDescriptor {
    MonitorDescriptor::new(id, id, MonitorRect::new(x, y, width, height, 1.0), false)
}

fn monitors() -> Vec<MonitorDescriptor> {
    vec![
        MonitorDescriptor::new(
            "primary",
            "Built-in display",
            MonitorRect::new(0.0, 0.0, 1920.0, 1080.0, 1.0),
            true,
        ),
        rect("secondary", 1920.0, 0.0, 1920.0, 1080.0),
    ]
}

#[test]
fn adjacent_monitor_removes_shared_right_edge_from_hot_zone() {
    let left = rect("left", 0.0, 0.0, 1920.0, 1080.0);
    let right = rect("right", 1920.0, 0.0, 1920.0, 1080.0);
    assert!(external_right_segments(&left.rect, &[left.rect.clone(), right.rect]).is_empty());
}

#[test]
fn disconnected_selection_falls_back_to_primary() {
    assert_eq!(
        resolve_selected_monitor(Some("missing"), &monitors()).id,
        "primary"
    );
}

#[test]
fn partially_overlapping_monitor_only_removes_overlapped_vertical_range() {
    let selected = rect("selected", 0.0, 0.0, 1920.0, 1080.0);
    let neighbour = rect("neighbour", 1920.0, 300.0, 1920.0, 300.0);
    assert_eq!(
        external_right_segments(&selected.rect, &[selected.rect.clone(), neighbour.rect]),
        vec![(0.0, 300.0), (600.0, 1080.0)]
    );
}

#[test]
fn selected_monitor_keeps_stable_id_and_primary_flag() {
    let all = monitors();
    let selected = resolve_selected_monitor(Some("secondary"), &all);
    assert_eq!(selected.id, "secondary");
    assert!(!selected.is_primary);
}

#[test]
fn monitor_options_warn_when_right_edge_is_a_shared_seam() {
    let left = rect("left", 0.0, 0.0, 1920.0, 1080.0);
    let right = rect("right", 1920.0, 0.0, 1920.0, 1080.0);
    let options = monitor_options(&[left, right]);

    assert!(!options[0].has_external_edge);
    assert!(options[0].warning.is_some());
    assert!(options[1].has_external_edge);
    assert!(options[1].warning.is_none());
}
