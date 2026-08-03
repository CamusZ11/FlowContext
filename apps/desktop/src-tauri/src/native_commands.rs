use keyring::Entry;
use tauri::{AppHandle, Wry};
use tauri_plugin_opener::OpenerExt;
use url::Url;

const KEYRING_SERVICE: &str = "com.camus.flowcontext.auth.v2";

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
            if url
                .path_segments()
                .is_some_and(|mut segments| segments.any(|part| !part.is_empty())) =>
        {
            Ok(())
        }
        Some("new") => Ok(()),
        _ => Err("unsupported codex link".to_owned()),
    }
}

pub fn secure_storage_key(key: &str) -> Result<String, String> {
    if key.is_empty() || key.len() > 256 || key.chars().any(char::is_control) {
        return Err("invalid secure storage key".to_owned());
    }
    Ok(format!("flowcontext:{key}"))
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

#[tauri::command]
pub fn open_codex_link(app: AppHandle<Wry>, url: String) -> Result<(), String> {
    validate_codex_link(&url)?;
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|error| error.to_string())
}
