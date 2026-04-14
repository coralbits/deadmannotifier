use std::path::PathBuf;

use clap::{Parser, Subcommand};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(
    name = "dms",
    version,
    about = "Dead Man Notifier — monitor service health"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the HTTP server
    Serve {
        #[arg(short = 'c', long, default_value = "config.yaml")]
        config: PathBuf,
        #[arg(short = 'H', long)]
        host: Option<String>,
        #[arg(short = 'p', long)]
        port: Option<u16>,
        #[arg(long)]
        with_cron: bool,
        #[arg(long)]
        watch: bool,
    },
    /// List configured services and their last known state
    List {
        #[arg(short = 'c', long, default_value = "config.yaml")]
        config: PathBuf,
    },
    /// Show the latest stored event per configured service
    Logs {
        #[arg(short = 'c', long, default_value = "config.yaml")]
        config: PathBuf,
        #[arg(short = 'n', long, default_value_t = 10)]
        limit: u32,
    },
    /// Run the periodic report once (or manage host crontab)
    Cron {
        #[arg(short = 'c', long, default_value = "config.yaml")]
        config: PathBuf,
        #[arg(long)]
        init: bool,
        #[arg(long)]
        test: bool,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Serve {
            config,
            host,
            port,
            with_cron,
            watch,
        } => {
            deadmannotifier::commands::serve::run(deadmannotifier::commands::serve::ServeOptions {
                config,
                host,
                port,
                with_cron_cli: if with_cron { Some(true) } else { None },
                watch,
            })
            .await?;
        }
        Commands::List { config } => {
            deadmannotifier::commands::list::run(config).await?;
        }
        Commands::Logs { config, limit } => {
            deadmannotifier::commands::logs::run(config, limit).await?;
        }
        Commands::Cron { config, init, test } => {
            deadmannotifier::commands::cron::run(config, init, test).await?;
        }
    }

    Ok(())
}
