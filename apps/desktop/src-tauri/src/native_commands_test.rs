use super::native_commands::{
    read_device_token_clear_intent, runtime_platform, secure_storage_key, secure_storage_service,
    validate_codex_link,
};
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

struct FakeLauncher {
    fail: bool,
    launched: std::cell::RefCell<Vec<String>>,
}

impl super::native_commands::ExternalLauncher for FakeLauncher {
    fn launch(&self, url: &str) -> Result<(), String> {
        if self.fail {
            return Err("handler missing".to_owned());
        }
        self.launched.borrow_mut().push(url.to_owned());
        Ok(())
    }
}

#[test]
fn validates_supported_codex_deep_links() {
    assert!(validate_codex_link("codex://threads/thread-1").is_ok());
    assert!(validate_codex_link("codex://threads/%E4%B8%AD%E6%96%87%20thread").is_ok());
    assert!(validate_codex_link("codex://new?path=%2Fworkspace&prompt=continue").is_ok());
}

#[test]
fn rejects_non_codex_and_incomplete_deep_links() {
    assert!(validate_codex_link("https://example.com").is_err());
    assert!(validate_codex_link("codex://threads/").is_err());
    assert!(validate_codex_link("codex://threads/one/two").is_err());
    assert!(validate_codex_link("codex://new/extra").is_err());
    assert!(validate_codex_link("codex://other/action").is_err());
    assert!(validate_codex_link("codex://untrusted@new").is_err());
    assert!(validate_codex_link("codex://new:444").is_err());
    assert!(validate_codex_link("file:///tmp/FlowContext").is_err());
}

#[test]
fn reports_the_compile_target_instead_of_a_webview_user_agent() {
    assert!(matches!(runtime_platform(), "windows" | "macos"));
    #[cfg(target_os = "windows")]
    assert_eq!(runtime_platform(), "windows");
    #[cfg(target_os = "macos")]
    assert_eq!(runtime_platform(), "macos");
}

#[test]
fn launcher_only_receives_validated_routes_and_returns_actionable_failures() {
    let launcher = FakeLauncher {
        fail: false,
        launched: std::cell::RefCell::new(Vec::new()),
    };
    super::native_commands::launch_codex_link(&launcher, "codex://threads/thread-1").unwrap();
    assert_eq!(
        launcher.launched.borrow().as_slice(),
        ["codex://threads/thread-1"]
    );
    assert!(super::native_commands::launch_codex_link(&launcher, "file:///tmp/x").is_err());

    let failing = FakeLauncher {
        fail: true,
        launched: std::cell::RefCell::new(Vec::new()),
    };
    assert!(
        super::native_commands::launch_codex_link(&failing, "codex://new")
            .unwrap_err()
            .contains("无法打开 Codex")
    );
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
