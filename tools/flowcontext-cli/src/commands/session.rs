use anyhow::Result;
use clap::Args;

use crate::client::{read_json_file, FlowContextClient, SessionStart};

#[derive(Debug, Args)]
pub struct SessionArgs {
    #[arg(long)]
    pub json: String,
}

pub async fn run(client: &FlowContextClient, args: SessionArgs) -> Result<()> {
    let input: SessionStart = read_json_file(args.json).await?;
    let result = client.start_session(&input).await?;
    println!("session started: {}", result.id);
    Ok(())
}
