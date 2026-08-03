use anyhow::Result;
use clap::Args;

use crate::client::{read_json_file, FlowContextClient, ProjectionSnapshot};

#[derive(Debug, Args)]
pub struct ProjectionArgs {
    #[arg(long)]
    pub json: String,
}

pub async fn run(client: &FlowContextClient, args: ProjectionArgs) -> Result<()> {
    let input: ProjectionSnapshot = read_json_file(args.json).await?;
    let ids = client.push_projection(&input).await?;
    println!("projection persisted: {} objects", ids.len());
    for id in ids {
        println!("object: {id}");
    }
    Ok(())
}
