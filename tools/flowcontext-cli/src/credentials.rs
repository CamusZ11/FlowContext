use anyhow::{Context, Result};
use secrecy::{ExposeSecret, SecretString};
use std::io::{self, Read};

const SERVICE_NAME: &str = "FlowContext";

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
    let token = entry
        .get_password()
        .context("load FlowContext device token")?;
    if token.trim().is_empty() {
        anyhow::bail!("stored FlowContext device token is empty");
    }
    Ok(SecretString::from(token))
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
