use super::macos_window::fullscreen_overlay_behavior;
use objc2_app_kit::NSWindowCollectionBehavior;

#[test]
fn fullscreen_overlay_joins_all_spaces_and_preserves_existing_behavior() {
    let current = NSWindowCollectionBehavior::Stationary;
    let actual = fullscreen_overlay_behavior(current);
    assert!(actual.contains(NSWindowCollectionBehavior::CanJoinAllSpaces));
    assert!(actual.contains(NSWindowCollectionBehavior::FullScreenAuxiliary));
    assert!(actual.contains(NSWindowCollectionBehavior::Stationary));
}
