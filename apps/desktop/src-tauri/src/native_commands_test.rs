use super::native_commands::{secure_storage_key, secure_storage_service, validate_codex_link};

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
        secure_storage_key("supabase.session").unwrap(),
        "flowcontext:supabase.session"
    );
    assert!(secure_storage_key("").is_err());
    assert!(secure_storage_key("bad\nkey").is_err());
}
