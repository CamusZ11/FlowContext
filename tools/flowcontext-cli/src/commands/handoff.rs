use anyhow::Result;
use clap::Args;

use crate::client::{read_json_file, FlowContextClient, HandoffCreate};

#[derive(Debug, Args)]
pub struct HandoffArgs {
    #[arg(long)]
    pub json: String,
}

pub async fn run(client: &FlowContextClient, args: HandoffArgs) -> Result<()> {
    let input: HandoffCreate = read_json_file(args.json).await?;
    let result = client.create_handoff(&input).await?;
    println!("handoff persisted: {}", result.id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[tokio::test]
    async fn input_file_is_read_without_putting_content_in_arguments() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("handoff.json");
        fs::write(&path, r#"{"sessionId":"s1","topicCardId":"t1","content":"secret handoff","idempotencyKey":"s1:k"}"#).unwrap();
        let input: HandoffCreate = read_json_file(path).await.unwrap();
        assert_eq!(input.idempotency_key, "s1:k");
        assert_eq!(input.content, "secret handoff");
    }
}
