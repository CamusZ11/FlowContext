use anyhow::{Context, Result};
use secrecy::{ExposeSecret, SecretString};
use std::io::{self, Read};
use std::path::Path;

const SERVICE_NAME: &str = "FlowContext";
const TOKEN_FILE_ENV: &str = "FLOWCONTEXT_TOKEN_FILE";

pub fn store_token(device_id: &str, token: SecretString) -> Result<()> {
    let entry =
        keyring::Entry::new(SERVICE_NAME, device_id).context("create FlowContext keyring entry")?;
    entry
        .set_password(token.expose_secret())
        .context("store FlowContext device token")
}

pub fn load_token(device_id: &str) -> Result<SecretString> {
    let entry =
        keyring::Entry::new(SERVICE_NAME, device_id).context("create FlowContext keyring entry")?;
    match entry.get_password() {
        Ok(token) => token_from_text(token),
        Err(keyring_error) => {
            let Some(path) = std::env::var_os(TOKEN_FILE_ENV) else {
                return Err(keyring_error).context("load FlowContext device token");
            };
            load_token_from_file(Path::new(&path)).context("load FlowContext device token fallback")
        }
    }
}

fn load_token_from_file(path: &Path) -> Result<SecretString> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mode = std::fs::metadata(path)
            .context("inspect FlowContext device token fallback")?
            .permissions()
            .mode();
        if mode & 0o077 != 0 {
            anyhow::bail!("FlowContext device token fallback must be owner-only");
        }
    }
    let token = std::fs::read_to_string(path).context("read FlowContext device token fallback")?;
    token_from_text(token)
}

fn token_from_text(token: String) -> Result<SecretString> {
    if token.trim().is_empty() {
        anyhow::bail!("stored FlowContext device token is empty");
    }
    Ok(SecretString::from(token.trim().to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    #[test]
    fn loads_a_nonempty_token_from_a_local_fallback_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("device-token");
        fs::write(&path, "token-from-file\n").unwrap();
        #[cfg(unix)]
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();

        let token = load_token_from_file(&path).unwrap();

        assert_eq!(token.expose_secret(), "token-from-file");
    }
}

pub fn read_token_from_stdin() -> Result<SecretString> {
    let mut token = String::new();
    io::stdin()
        .read_to_string(&mut token)
        .context("read device token from stdin")?;
    let token = token.trim().to_owned();
    if token.is_empty() {
        anyhow::bail!("device token cannot be empty");
    }
    Ok(SecretString::from(token))
}
