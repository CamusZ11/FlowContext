use anyhow::Result;
use clap::Args;

use crate::client::{read_json_file, FlowContextClient, TodoCreate};

#[derive(Debug, Args)]
pub struct TodoArgs {
    #[arg(long)]
    pub json: String,
}

pub async fn run(client: &FlowContextClient, args: TodoArgs) -> Result<()> {
    let input: TodoCreate = read_json_file(args.json).await?;
    let result = client.create_todo(&input).await?;
    println!("todo persisted: {}", result.id);
    Ok(())
}
