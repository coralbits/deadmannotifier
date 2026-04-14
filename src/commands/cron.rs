use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::config::AppConfig;
use crate::cron_runner::run_cron_job;
use crate::db::Store;
use crate::error::Result;

pub async fn run(config_path: PathBuf, init: bool, test: bool) -> Result<()> {
    if init {
        init_crontab(&config_path)?;
        return Ok(());
    }

    println!("Checking if cron job should run...");

    let cfg = AppConfig::load_from_path(&config_path)?;
    let store = Store::open(&cfg.database.path)?;

    if test {
        println!("Running in test mode - email will be written to file");
        run_cron_job(&store, &cfg, true).await?;
    } else {
        // Parity with Node: each invocation runs the full job (see AGENTS.md).
        run_cron_job(&store, &cfg, false).await?;
    }

    println!("Cron check completed.");
    Ok(())
}

fn init_crontab(config_path: &PathBuf) -> Result<()> {
    let exe = std::env::current_exe().map_err(|e| crate::error::Error::Other(e.to_string()))?;
    let exe_dir = exe
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    let config_abs = std::fs::canonicalize(config_path).unwrap_or_else(|_| config_path.clone());

    let cron_line = format!(
        "* * * * * cd \"{}\" && \"{}\" cron -c \"{}\"",
        exe_dir.display(),
        exe.display(),
        config_abs.display()
    );

    let current = Command::new("crontab")
        .arg("-l")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    if current.contains("deadmannotifier") || current.contains("dms cron") {
        println!("Cron entry for Dead Man Notifier already exists.");
        println!("Current crontab:\n{current}");
        return Ok(());
    }

    let new_crontab = format!(
        "{}{}# Dead Man Notifier\n{cron_line}\n",
        current,
        if current.is_empty() || current.ends_with('\n') {
            ""
        } else {
            "\n"
        }
    );

    let mut child = Command::new("crontab")
        .arg("-")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| {
            crate::error::Error::Other(format!(
                "failed to spawn crontab (do you have crontab installed?): {e}"
            ))
        })?;

    use std::io::Write;
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(new_crontab.as_bytes())
        .map_err(|e| crate::error::Error::Other(e.to_string()))?;

    let status = child
        .wait()
        .map_err(|e| crate::error::Error::Other(e.to_string()))?;
    if !status.success() {
        return Err(crate::error::Error::Other(
            "crontab rejected the new crontab".into(),
        ));
    }

    println!("Cron entry added successfully!");
    println!("Entry: {cron_line}");
    println!("\nTo verify, run: crontab -l");
    Ok(())
}
