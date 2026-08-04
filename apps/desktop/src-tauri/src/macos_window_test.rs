use super::macos_window::{
    fullscreen_overlay_behavior, fullscreen_overlay_ordering, fullscreen_overlay_panel_profile,
    OverlayOrdering,
};
use objc2_app_kit::NSWindowCollectionBehavior;

#[test]
fn fullscreen_overlay_replaces_conflicting_collection_roles() {
    let current = NSWindowCollectionBehavior::Primary
        | NSWindowCollectionBehavior::Managed
        | NSWindowCollectionBehavior::FullScreenPrimary
        | NSWindowCollectionBehavior::MoveToActiveSpace;
    let actual = fullscreen_overlay_behavior(current);
    assert!(actual.contains(NSWindowCollectionBehavior::CanJoinAllSpaces));
    assert!(actual.contains(NSWindowCollectionBehavior::CanJoinAllApplications));
    assert!(actual.contains(NSWindowCollectionBehavior::FullScreenAuxiliary));
    assert!(actual.contains(NSWindowCollectionBehavior::Stationary));
    assert!(!actual.intersects(
        NSWindowCollectionBehavior::Primary
            | NSWindowCollectionBehavior::Auxiliary
            | NSWindowCollectionBehavior::Managed
            | NSWindowCollectionBehavior::Transient
            | NSWindowCollectionBehavior::FullScreenPrimary
            | NSWindowCollectionBehavior::FullScreenNone
            | NSWindowCollectionBehavior::MoveToActiveSpace,
    ));
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
fn fullscreen_overlay_collection_profile_is_idempotent() {
    let current = NSWindowCollectionBehavior::Auxiliary
        | NSWindowCollectionBehavior::Transient
        | NSWindowCollectionBehavior::FullScreenNone;
    let once = fullscreen_overlay_behavior(current);

    assert_eq!(fullscreen_overlay_behavior(once), once);
}

#[test]
fn fullscreen_overlay_panel_profile_is_nonactivating_and_above_fullscreen_content() {
    let profile = fullscreen_overlay_panel_profile();

    assert!(profile.nonactivating);
    assert!(profile.floating);
    assert!(!profile.hides_on_deactivate);
    assert!(profile.becomes_key_only_if_needed);
    assert_eq!(profile.level, 1000);
    assert_eq!(
        profile.collection_behavior,
        fullscreen_overlay_behavior(NSWindowCollectionBehavior::empty()),
    );
}

#[test]
fn fullscreen_overlay_uses_nonactivating_native_ordering() {
    assert_eq!(
        fullscreen_overlay_ordering(),
        [
            OverlayOrdering::OrderFrontRegardless,
            OverlayOrdering::OrderOut
        ],
    );
}
