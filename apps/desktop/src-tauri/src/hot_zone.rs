//! Pure edge-trigger state machine.
//!
//! The state machine deliberately knows nothing about Tauri.  Keeping cursor,
//! monitor and window values as plain data makes the timing contract testable
//! on every platform and lets the runtime swap in a different window port.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn contains(self, point: Point) -> bool {
        point.x >= self.x
            && point.x <= self.x + self.width
            && point.y >= self.y
            && point.y <= self.y + self.height
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MonitorRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale_factor: f64,
    /// Vertical portions of the selected monitor's right edge which are
    /// exposed to the desktop.  A default monitor exposes its full height.
    pub external_right_segments: Vec<(f64, f64)>,
}

impl MonitorRect {
    pub fn new(x: f64, y: f64, width: f64, height: f64, scale_factor: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
            scale_factor: if scale_factor.is_finite() && scale_factor > 0.0 {
                scale_factor
            } else {
                1.0
            },
            external_right_segments: vec![(y, y + height)],
        }
    }

    pub fn with_external_right_segments(mut self, segments: Vec<(f64, f64)>) -> Self {
        self.external_right_segments = segments;
        self
    }

    pub fn right(&self) -> f64 {
        self.x + self.width
    }

    pub fn contains_external_right_edge(&self, point: Point, edge_px: f64) -> bool {
        if !point.x.is_finite() || !point.y.is_finite() {
            return false;
        }
        let edge = edge_px.max(0.0);
        let left = self.right() - edge;
        point.x >= left
            && point.x <= self.right() + f64::EPSILON
            && self
                .external_right_segments
                .iter()
                .any(|(start, end)| point.y >= *start && point.y <= *end)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Show,
    Hide,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindowState {
    pub visible: bool,
    pub animating: bool,
    pub bounds: Option<Rect>,
}

impl WindowState {
    pub const fn hidden() -> Self {
        Self {
            visible: false,
            animating: false,
            bounds: None,
        }
    }

    pub const fn hidden_animating() -> Self {
        Self {
            visible: false,
            animating: true,
            bounds: None,
        }
    }

    pub const fn visible(bounds: Rect) -> Self {
        Self {
            visible: true,
            animating: false,
            bounds: Some(bounds),
        }
    }

    pub const fn visible_animating(bounds: Rect) -> Self {
        Self {
            visible: true,
            animating: true,
            bounds: Some(bounds),
        }
    }
}

#[derive(Clone, Debug)]
pub struct HotZoneEngine {
    edge_px: f64,
    show_after_ms: u64,
    hide_after_ms: u64,
    entered_at: Option<u64>,
    left_at: Option<u64>,
    show_fired: bool,
    hide_fired: bool,
    pointer_has_entered_visible_panel: bool,
    last_window_visible: bool,
    require_edge_exit: bool,
}

impl HotZoneEngine {
    pub fn new(edge_px: f64, show_after_ms: u64, _hide_after_ms: u64) -> Self {
        Self {
            edge_px: edge_px.max(0.0),
            show_after_ms,
            // Product behavior is hide on the first stable sample outside the
            // panel. Keep the argument for source compatibility.
            hide_after_ms: 0,
            entered_at: None,
            left_at: None,
            show_fired: false,
            hide_fired: false,
            pointer_has_entered_visible_panel: false,
            last_window_visible: false,
            require_edge_exit: false,
        }
    }

    pub fn sample(
        &mut self,
        now: u64,
        cursor: Point,
        monitor: MonitorRect,
        window: WindowState,
    ) -> Vec<Action> {
        if window.animating {
            return Vec::new();
        }

        if !window.visible {
            if self.last_window_visible {
                self.require_edge_exit = true;
                self.entered_at = None;
                self.show_fired = false;
            }
            self.last_window_visible = false;
            self.pointer_has_entered_visible_panel = false;
            self.left_at = None;
            self.hide_fired = false;
            return self.sample_hidden(now, cursor, &monitor);
        }

        self.last_window_visible = true;
        self.sample_visible(now, cursor, window.bounds)
    }

    fn sample_hidden(&mut self, now: u64, cursor: Point, monitor: &MonitorRect) -> Vec<Action> {
        let inside = monitor.contains_external_right_edge(cursor, self.edge_px);
        if !inside {
            self.entered_at = None;
            self.show_fired = false;
            self.require_edge_exit = false;
            return Vec::new();
        }

        if self.require_edge_exit || self.show_fired {
            return Vec::new();
        }

        let entered_at = *self.entered_at.get_or_insert(now);
        if now.saturating_sub(entered_at) >= self.show_after_ms {
            self.show_fired = true;
            self.entered_at = None;
            return vec![Action::Show];
        }
        Vec::new()
    }

    fn sample_visible(&mut self, now: u64, cursor: Point, bounds: Option<Rect>) -> Vec<Action> {
        let Some(bounds) = bounds else {
            self.left_at = None;
            return Vec::new();
        };
        if !cursor.x.is_finite()
            || !cursor.y.is_finite()
            || !bounds.x.is_finite()
            || !bounds.y.is_finite()
            || !bounds.width.is_finite()
            || !bounds.height.is_finite()
            || bounds.width <= 0.0
            || bounds.height <= 0.0
        {
            self.left_at = None;
            return Vec::new();
        }

        if bounds.contains(cursor) {
            self.pointer_has_entered_visible_panel = true;
            self.left_at = None;
            self.hide_fired = false;
            return Vec::new();
        }

        if !self.pointer_has_entered_visible_panel || self.hide_fired {
            return Vec::new();
        }

        let left_at = *self.left_at.get_or_insert(now);
        if now.saturating_sub(left_at) >= self.hide_after_ms {
            self.hide_fired = true;
            self.left_at = None;
            return vec![Action::Hide];
        }
        Vec::new()
    }
}
