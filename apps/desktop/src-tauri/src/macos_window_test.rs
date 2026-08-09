use super::macos_window::fullscreen_overlay_behavior;
use objc2_app_kit::NSWindowCollectionBehavior;

#[test]
fn fullscreen_overlay_joins_other_app_fullscreen_spaces_with_one_role() {
    let current = NSWindowCollectionBehavior::Stationary;
    let actual = fullscreen_overlay_behavior(current);
    assert!(actual.contains(NSWindowCollectionBehavior::CanJoinAllSpaces));
    assert!(actual.contains(NSWindowCollectionBehavior::CanJoinAllApplications));
    assert!(actual.contains(NSWindowCollectionBehavior::FullScreenAuxiliary));
    assert!(actual.contains(NSWindowCollectionBehavior::Stationary));
}

#[test]
fn fullscreen_overlay_preserves_unrelated_and_unknown_collection_bits() {
    let unknown = NSWindowCollectionBehavior::from_bits_retain(1 << 31);
    let current = NSWindowCollectionBehavior::IgnoresCycle
        | NSWindowCollectionBehavior::FullScreenDisallowsTiling
        | unknown;
    let actual = fullscreen_overlay_behavior(current);

    assert!(actual.contains(NSWindowCollectionBehavior::IgnoresCycle));
    assert!(actual.contains(NSWindowCollectionBehavior::FullScreenDisallowsTiling));
    assert!(actual.contains(unknown));
}

#[test]
fn fullscreen_overlay_behavior_is_idempotent() {
    let current = NSWindowCollectionBehavior::Auxiliary
        | NSWindowCollectionBehavior::Transient
        | NSWindowCollectionBehavior::MoveToActiveSpace;
    let once = fullscreen_overlay_behavior(current);

    assert_eq!(fullscreen_overlay_behavior(once), once);
}
