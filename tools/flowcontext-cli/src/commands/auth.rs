use anyhow::Result;
use clap::Args;

use crate::credentials::{read_token_from_stdin, store_token};

#[derive(Debug, Args)]
pub struct StoreTokenArgs {
    #[arg(long)]
    pub device: String,
    #[arg(long)]
    pub stdin: bool,
}

pub fn run_store_token(args: StoreTokenArgs) -> Result<()> {
    if !args.stdin {
        anyhow::bail!("--stdin is required so the token is not passed in argv");
    }
    let token = read_token_from_stdin()?;
    store_token(&args.device, token)?;
    println!("stored device token for {}", args.device);
    Ok(())
}
