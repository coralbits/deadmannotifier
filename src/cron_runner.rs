use crate::config::AppConfig;
use crate::cron_logic::{gather_cron_data, service_group_map, service_name_map, CronData};
use crate::db::Store;
use crate::domain::ServiceState;
use crate::email::{build_email_html, send_status_email, write_email_preview_file};
use crate::error::Result;

pub const MARKER_SERVICE_ID: &str = "cron-job-marker";
pub const CRON_JOB_MARKER: &str = "CRON_JOB_MARKER";

pub fn log_cron_report(
    data: &CronData,
    names: &std::collections::HashMap<String, String>,
    groups: &std::collections::HashMap<String, String>,
) {
    println!("\n=== DEAD MAN NOTIFIER REPORT ===");
    println!("Generated on: {}", chrono::Utc::now().to_rfc3339());

    println!("\nService Status Summary:");
    println!("========================");
    if data.services.is_empty() {
        println!("No services configured.");
    } else {
        for s in &data.services {
            let name = names
                .get(&s.service_id)
                .map(String::as_str)
                .unwrap_or("Unknown Service");
            let group = groups.get(&s.service_id).map(String::as_str).unwrap_or("—");
            println!(
                "{:14} | {:20} | {:3} | {}",
                group,
                name,
                s.state.as_str().to_uppercase(),
                s.last_updated
            );
        }
    }

    if !data.events.is_empty() {
        println!("\nRecent Logs:");
        println!("============");
        for e in &data.events {
            let name = names
                .get(&e.service_id)
                .map(String::as_str)
                .unwrap_or("Unknown Service");
            println!(
                "{} | {:20} | {:3} | {}",
                e.timestamp,
                name,
                e.state.to_uppercase(),
                e.source_ip.as_deref().unwrap_or("unknown")
            );
            if let Some(logs) = &e.logs {
                for line in logs.lines() {
                    println!("    {line}");
                }
            }
        }
    }

    let worst = crate::cron_logic::worst_state_for_cron(&data.services);
    println!("\nWorst state detected: {}", worst.as_str().to_uppercase());
    println!("========================\n");
}

/// Runs the cron cycle: gather, print report, then either test email file or send + reset + marker.
pub async fn run_cron_job(store: &Store, config: &AppConfig, test_mode: bool) -> Result<()> {
    let data = gather_cron_data(config, store)?;
    let names = service_name_map(config);
    let groups = service_group_map(config);
    log_cron_report(&data, &names, &groups);

    if test_mode {
        let (subject, html) =
            build_email_html(&config.email, &data.services, &data.events, &names, &groups)?;
        let path = write_email_preview_file(&html).await?;
        let url = format!("file://{}", path.display());
        println!("Email content written to: {url}");
        println!("You can open this file in your browser to preview the email.");
        println!("\nNote: Services were NOT reset to NAK status in test mode.");
        let _ = subject;
        return Ok(());
    }

    let (subject, html) =
        build_email_html(&config.email, &data.services, &data.events, &names, &groups)?;
    send_status_email(&config.email, &html, &subject).await?;

    store.mark_all_services_as_nak()?;
    println!("All services marked as NAK after email sent");

    store.insert_event(
        MARKER_SERVICE_ID,
        ServiceState::Nak,
        Some(CRON_JOB_MARKER),
        Some("system"),
    )?;
    Ok(())
}
