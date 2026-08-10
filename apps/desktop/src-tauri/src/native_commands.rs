use keyring::Entry;
use std::{fs, io::ErrorKind, path::Path};
use tauri::{AppHandle, Wry};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::{resolve_store_path, StoreExt};
use url::Url;

const KEYRING_SERVICE: &str = "com.camus.flowcontext.auth.v2";
const AUTH_STATE_FILE: &str = "auth-state.json";
const DEVICE_TOKEN_CLEAR_INTENT_KEY: &str = "device-token-clear-pending";

pub const fn runtime_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else {
        "macos"
    }
}

#[tauri::command]
pub fn get_runtime_platform() -> &'static str {
    runtime_platform()
}

pub fn secure_storage_service() -> &'static str {
    KEYRING_SERVICE
}

pub fn validate_codex_link(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|_| "invalid codex link".to_owned())?;
    if url.scheme() != "codex" {
        return Err("only codex:// links are allowed".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return Err("codex links cannot contain credentials or ports".to_owned());
    }
    match url.host_str() {
        Some("threads")
            if url.path_segments().is_some_and(|segments| {
                let parts = segments.filter(|part| !part.is_empty()).collect::<Vec<_>>();
                parts.len() == 1 && !parts[0].trim().is_empty()
            }) =>
        {
            Ok(())
        }
        Some("new") if url.path() == "/" || url.path().is_empty() => Ok(()),
        _ => Err("unsupported codex link".to_owned()),
    }
}

pub fn secure_storage_key(key: &str) -> Result<String, String> {
    if key.is_empty() || key.len() > 256 || key.chars().any(char::is_control) {
        return Err("invalid secure storage key".to_owned());
    }
    Ok(format!("flowcontext:{key}"))
}

pub trait ExternalLauncher {
    fn launch(&self, url: &str) -> Result<(), String>;
}

struct TauriExternalLauncher<'a> {
    app: &'a AppHandle<Wry>,
}

impl ExternalLauncher for TauriExternalLauncher<'_> {
    fn launch(&self, url: &str) -> Result<(), String> {
        self.app
            .opener()
            .open_url(url, None::<String>)
            .map_err(|error| error.to_string())
    }
}

pub fn launch_codex_link<L: ExternalLauncher>(launcher: &L, url: &str) -> Result<(), String> {
    validate_codex_link(url)?;
    launcher
        .launch(url)
        .map_err(|_| "无法打开 Codex。请确认已安装可处理 codex:// 的应用后重试。".to_owned())
}

#[cfg(feature = "ci-mock-launcher")]
fn test_launch_url(args: &[String]) -> Option<&str> {
    args.windows(2)
        .find(|pair| pair[0] == "--flowcontext-test-launch")
        .map(|pair| pair[1].as_str())
}

#[cfg(feature = "ci-mock-launcher")]
pub fn handle_ci_mock_launcher(args: &[String]) -> Result<bool, String> {
    let Some(url) = test_launch_url(args) else {
        return Ok(false);
    };
    validate_codex_link(url)?;
    let kind = match Url::parse(url)
        .ok()
        .and_then(|value| value.host_str().map(str::to_owned))
    {
        Some(host) if host == "threads" => "threads",
        Some(host) if host == "new" => "new",
        _ => return Err("unsupported codex test route".to_owned()),
    };
    let path = std::env::var("FLOWCONTEXT_EXTERNAL_LAUNCHER_LOG")
        .map_err(|_| "mock launcher log path is not configured".to_owned())?;
    if std::env::var("FLOWCONTEXT_EXTERNAL_LAUNCHER").as_deref() != Ok("mock") {
        return Err("mock launcher is not enabled".to_owned());
    }
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{kind}").map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(not(feature = "ci-mock-launcher"))]
pub fn handle_ci_mock_launcher(_args: &[String]) -> Result<bool, String> {
    Ok(false)
}

fn entry(key: &str) -> Result<Entry, String> {
    let user = secure_storage_key(key)?;
    Entry::new(secure_storage_service(), &user).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secure_storage_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn secure_storage_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secure_storage_remove(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn read_device_token_clear_intent(path: &Path) -> Result<bool, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.to_string()),
    };
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    let state = value
        .as_object()
        .ok_or_else(|| "invalid device token clear intent store".to_owned())?;
    match state.get(DEVICE_TOKEN_CLEAR_INTENT_KEY) {
        None => Ok(false),
        Some(serde_json::Value::Bool(value)) => Ok(*value),
        Some(_) => Err("invalid device token clear intent marker".to_owned()),
    }
}

/// This marker deliberately lives outside the native credential provider.
/// It contains no credential material; it only prevents a previously cleared
/// token from becoming readable again if both Keychain overwrite and delete
/// fail during the same logout attempt.
#[tauri::command]
pub fn device_token_clear_intent_get(app: AppHandle<Wry>) -> Result<bool, String> {
    let path = resolve_store_path(&app, AUTH_STATE_FILE).map_err(|error| error.to_string())?;
    read_device_token_clear_intent(&path)
}

#[tauri::command]
pub fn device_token_clear_intent_set(app: AppHandle<Wry>) -> Result<(), String> {
    let store = app
        .store(AUTH_STATE_FILE)
        .map_err(|error| error.to_string())?;
    store.set(DEVICE_TOKEN_CLEAR_INTENT_KEY, true);
    store.save().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn device_token_clear_intent_remove(app: AppHandle<Wry>) -> Result<(), String> {
    let store = app
        .store(AUTH_STATE_FILE)
        .map_err(|error| error.to_string())?;
    store.delete(DEVICE_TOKEN_CLEAR_INTENT_KEY);
    store.save().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_codex_link(app: AppHandle<Wry>, url: String) -> Result<(), String> {
    launch_codex_link(&TauriExternalLauncher { app: &app }, &url)
}
