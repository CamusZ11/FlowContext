use super::diagnostics::{redact_monitor_id, DiagnosticsSnapshot};

fn snapshot() -> DiagnosticsSnapshot {
    DiagnosticsSnapshot {
        app_version: "0.1.0".to_owned(),
        commit: "9565d7b".to_owned(),
        platform: "windows".to_owned(),
        webview_version: Some("151.0".to_owned()),
        selected_monitor_hash: Some("monitor-hash".to_owned()),
        monitor_rectangles: vec!["0,0,1920,1080".to_owned()],
        scale_factors: vec![1.5],
        window_bounds: Some("1500,0,420,1080".to_owned()),
        heat_zone_enabled: true,
        sse_state: "connected".to_owned(),
        launcher_result: "opened".to_owned(),
    }
}

#[test]
fn diagnostics_contains_only_operational_metadata() {
    let json = snapshot().to_redacted_json().unwrap();
    assert!(json.contains("monitor-hash"));
    assert!(!json.contains("Authorization"));
}

#[test]
fn diagnostics_rejects_sensitive_values_even_if_a_caller_misuses_a_safe_field() {
    let mut value = snapshot();
    value.launcher_result = "codex://new?prompt=secret".to_owned();
    assert!(value.to_redacted_json().is_err());
}

#[test]
fn monitor_identity_is_stable_but_not_exposed_verbatim() {
    let value = redact_monitor_id("\\\\.\\DISPLAY1");
    assert_eq!(value, redact_monitor_id("\\\\.\\DISPLAY1"));
    assert_ne!(value, "\\\\.\\DISPLAY1");
}
