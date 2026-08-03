use crate::hot_zone::MonitorRect;
use serde::Serialize;

const EPSILON: f64 = 0.5;

#[derive(Clone, Debug, PartialEq)]
pub struct MonitorDescriptor {
    pub id: String,
    pub label: String,
    pub rect: MonitorRect,
    pub is_primary: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MonitorOption {
    pub id: String,
    pub label: String,
    pub is_primary: bool,
    pub has_external_edge: bool,
    pub warning: Option<String>,
}

impl MonitorDescriptor {
    pub fn new(
        id: impl Into<String>,
        label: impl Into<String>,
        rect: MonitorRect,
        is_primary: bool,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            rect,
            is_primary,
        }
    }
}

pub fn resolve_selected_monitor<'a>(
    selected_id: Option<&str>,
    monitors: &'a [MonitorDescriptor],
) -> &'a MonitorDescriptor {
    if let Some(id) = selected_id {
        if let Some(selected) = monitors.iter().find(|monitor| monitor.id == id) {
            return selected;
        }
    }
    monitors
        .iter()
        .find(|monitor| monitor.is_primary)
        .or_else(|| monitors.first())
        .expect("at least one monitor is required")
}

/// Return the unoccupied vertical portions of `selected`'s right edge.
///
/// A monitor touching that edge at the same physical x coordinate owns the
/// shared seam, so the seam is never considered an external hot zone.
pub fn external_right_segments(selected: &MonitorRect, all: &[MonitorRect]) -> Vec<(f64, f64)> {
    let right = selected.right();
    let selected_start = selected.y;
    let selected_end = selected.y + selected.height;
    let mut covered: Vec<(f64, f64)> = all
        .iter()
        .filter(|monitor| !same_rect(monitor, selected))
        .filter(|monitor| (monitor.x - right).abs() <= EPSILON)
        .filter_map(|monitor| {
            let start = selected_start.max(monitor.y);
            let end = selected_end.min(monitor.y + monitor.height);
            (end - start > EPSILON).then_some((start, end))
        })
        .collect();

    covered.sort_by(|left, right| left.0.total_cmp(&right.0));
    let mut merged: Vec<(f64, f64)> = Vec::new();
    for (start, end) in covered {
        if let Some((_, previous_end)) = merged.last_mut() {
            if start <= *previous_end + EPSILON {
                *previous_end = (*previous_end).max(end);
                continue;
            }
        }
        merged.push((start, end));
    }

    let mut available = Vec::new();
    let mut cursor = selected_start;
    for (start, end) in merged {
        if start > cursor + EPSILON {
            available.push((cursor, start));
        }
        cursor = cursor.max(end);
    }
    if cursor < selected_end - EPSILON {
        available.push((cursor, selected_end));
    }
    available
}

fn same_rect(left: &MonitorRect, right: &MonitorRect) -> bool {
    (left.x - right.x).abs() <= EPSILON
        && (left.y - right.y).abs() <= EPSILON
        && (left.width - right.width).abs() <= EPSILON
        && (left.height - right.height).abs() <= EPSILON
}

pub fn with_external_segments(
    selected: &MonitorDescriptor,
    all: &[MonitorDescriptor],
) -> MonitorRect {
    let segments = external_right_segments(
        &selected.rect,
        &all.iter()
            .map(|monitor| monitor.rect.clone())
            .collect::<Vec<_>>(),
    );
    selected.rect.clone().with_external_right_segments(segments)
}

pub fn monitor_options(monitors: &[MonitorDescriptor]) -> Vec<MonitorOption> {
    let rects = monitors
        .iter()
        .map(|monitor| monitor.rect.clone())
        .collect::<Vec<_>>();
    monitors
        .iter()
        .map(|monitor| {
            let has_external_edge = !external_right_segments(&monitor.rect, &rects).is_empty();
            MonitorOption {
                id: monitor.id.clone(),
                label: monitor.label.clone(),
                is_primary: monitor.is_primary,
                has_external_edge,
                warning: (!has_external_edge)
                    .then(|| "此显示器右侧没有可用外部边缘；请使用托盘或快捷键".to_owned()),
            }
        })
        .collect()
}
