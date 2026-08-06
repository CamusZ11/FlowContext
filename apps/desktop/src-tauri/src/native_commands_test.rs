use super::native_commands::{
    read_device_token_clear_intent, secure_storage_key, secure_storage_service, validate_codex_link,
};
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn validates_supported_codex_deep_links() {
    assert!(validate_codex_link("codex://threads/thread-1").is_ok());
    assert!(validate_codex_link("codex://new?path=%2Fworkspace&prompt=continue").is_ok());
}

#[test]
fn rejects_non_codex_and_incomplete_deep_links() {
    assert!(validate_codex_link("https://example.com").is_err());
    assert!(validate_codex_link("codex://threads/").is_err());
    assert!(validate_codex_link("codex://other/action").is_err());
    assert!(validate_codex_link("codex://untrusted@new").is_err());
}

#[test]
fn secure_storage_keys_are_namespaced_and_bounded() {
    assert_eq!(secure_storage_service(), "com.camus.flowcontext.auth.v2");
    assert_eq!(
        secure_storage_key("legacy.session").unwrap(),
        "flowcontext:legacy.session"
    );
    assert!(secure_storage_key("").is_err());
    assert!(secure_storage_key("bad\nkey").is_err());
}

#[test]
fn clear_intent_state_distinguishes_missing_from_unreadable_or_malformed() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "flowcontext-clear-intent-{}-{unique}",
        std::process::id()
    ));
    let state_path = root.join("auth-state.json");

    assert_eq!(read_device_token_clear_intent(&state_path), Ok(false));

    fs::create_dir_all(&state_path).unwrap();
    assert!(read_device_token_clear_intent(&state_path).is_err());
    fs::remove_dir(&state_path).unwrap();

    fs::write(&state_path, b"not-json").unwrap();
    assert!(read_device_token_clear_intent(&state_path).is_err());

    fs::write(&state_path, br#"[]"#).unwrap();
    assert!(read_device_token_clear_intent(&state_path).is_err());

    fs::write(&state_path, br#"{"device-token-clear-pending":"true"}"#).unwrap();
    assert!(read_device_token_clear_intent(&state_path).is_err());

    fs::write(&state_path, br#"{}"#).unwrap();
    assert_eq!(read_device_token_clear_intent(&state_path), Ok(false));

    fs::write(&state_path, br#"{"device-token-clear-pending":true}"#).unwrap();
    assert_eq!(read_device_token_clear_intent(&state_path), Ok(true));

    fs::remove_file(&state_path).unwrap();
    fs::remove_dir(&root).unwrap();
}
