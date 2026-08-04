mod client;
mod commands;
mod credentials;

use anyhow::Result;
use clap::{Args, Parser, Subcommand};
use secrecy::SecretString;

use client::FlowContextClient;
use commands::{auth, handoff, projection, session, todo};

#[derive(Debug, Parser)]
#[command(name = "flowcontext", version, about = "FlowContext Codex bridge")]
struct Cli {
    #[arg(long, global = true, env = "FLOWCONTEXT_API_URL")]
    api_url: Option<String>,
    #[arg(long, global = true, env = "FLOWCONTEXT_DEVICE_ID")]
    device: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Auth {
        #[command(subcommand)]
        command: AuthCommand,
    },
    Session {
        #[command(subcommand)]
        command: SessionCommand,
    },
    Handoff {
        #[command(subcommand)]
        command: HandoffCommand,
    },
    Projection {
        #[command(subcommand)]
        command: ProjectionCommand,
    },
    Topic {
        #[command(subcommand)]
        command: TopicCommand,
    },
    Todo {
        #[command(subcommand)]
        command: TodoCommand,
    },
}

#[derive(Debug, Subcommand)]
enum AuthCommand {
    StoreToken(auth::StoreTokenArgs),
}

#[derive(Debug, Subcommand)]
enum SessionCommand {
    Start(session::SessionArgs),
}

#[derive(Debug, Subcommand)]
enum HandoffCommand {
    Create(handoff::HandoffArgs),
}

#[derive(Debug, Subcommand)]
enum ProjectionCommand {
    Push(projection::ProjectionArgs),
}

#[derive(Debug, Subcommand)]
enum TopicCommand {
    Complete(CompleteTopicArgs),
}

#[derive(Debug, Subcommand)]
enum TodoCommand {
    Create(todo::TodoArgs),
}

#[derive(Debug, Args)]
struct CompleteTopicArgs {
    #[arg(long)]
    topic: String,
    /// Required confirmation gate; omission is rejected by clap.
    #[arg(long, required = true)]
    explicit: bool,
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("flowcontext failed: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();
    let api_url = cli.api_url.clone();
    let device = cli.device.clone();
    match cli.command {
        Command::Auth {
            command: AuthCommand::StoreToken(args),
        } => auth::run_store_token(args),
        Command::Session {
            command: SessionCommand::Start(args),
        } => {
            let client = client_from_parts(api_url.as_deref(), device.as_deref())?;
            session::run(&client, args).await
        }
        Command::Handoff {
            command: HandoffCommand::Create(args),
        } => {
            let client = client_from_parts(api_url.as_deref(), device.as_deref())?;
            handoff::run(&client, args).await
        }
        Command::Projection {
            command: ProjectionCommand::Push(args),
        } => {
            let client = client_from_parts(api_url.as_deref(), device.as_deref())?;
            projection::run(&client, args).await
        }
        Command::Topic {
            command: TopicCommand::Complete(args),
        } => {
            let client = client_from_parts(api_url.as_deref(), device.as_deref())?;
            let result = client.complete_topic(&args.topic, args.explicit).await?;
            println!("topic completed: {}", result.id);
            Ok(())
        }
        Command::Todo {
            command: TodoCommand::Create(args),
        } => {
            let client = client_from_parts(api_url.as_deref(), device.as_deref())?;
            todo::run(&client, args).await
        }
    }
}

fn client_from_parts(api_url: Option<&str>, device: Option<&str>) -> Result<FlowContextClient> {
    let api_url =
        api_url.ok_or_else(|| anyhow::anyhow!("--api-url or FLOWCONTEXT_API_URL is required"))?;
    let device =
        device.ok_or_else(|| anyhow::anyhow!("--device or FLOWCONTEXT_DEVICE_ID is required"))?;
    let token: SecretString = credentials::load_token(device)?;
    FlowContextClient::new(api_url, token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_topic_requires_explicit_flag() {
        let result = Cli::try_parse_from(["flowcontext", "topic", "complete", "--topic", "t1"]);
        assert!(result.is_err());
    }
}
