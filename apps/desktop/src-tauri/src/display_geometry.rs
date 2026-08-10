use crate::hot_zone::Rect;

/// Physical display geometry supplied by the platform window adapter. Monitor
/// bounds own the edge trigger; work bounds own the visible panel placement.
#[derive(Clone, Debug, PartialEq)]
pub struct DisplayGeometry {
    pub stable_id: String,
    pub monitor_bounds: Rect,
    pub work_bounds: Rect,
    pub scale_factor: f64,
    pub right_taskbar: bool,
}

impl DisplayGeometry {
    pub fn new(
        stable_id: impl Into<String>,
        monitor_bounds: Rect,
        work_bounds: Rect,
        scale_factor: f64,
        right_taskbar: bool,
    ) -> Self {
        Self {
            stable_id: stable_id.into(),
            monitor_bounds,
            work_bounds,
            scale_factor: if scale_factor.is_finite() && scale_factor > 0.0 {
                scale_factor
            } else {
                1.0
            },
            right_taskbar,
        }
    }

    pub fn panel_bounds(&self, logical_width: f64) -> Rect {
        let width =
            (logical_width.max(1.0) * self.scale_factor).min(self.work_bounds.width.max(1.0));
        Rect::new(
            self.work_bounds.x + self.work_bounds.width - width,
            self.work_bounds.y,
            width,
            self.work_bounds.height.max(1.0),
        )
    }

    pub const fn hot_zone_enabled(&self) -> bool {
        !self.right_taskbar
    }

    pub fn hot_zone_disabled_reason(&self) -> Option<&'static str> {
        self.right_taskbar
            .then_some("所选显示器右侧任务栏占用热区；请使用快捷键或托盘")
    }
}
