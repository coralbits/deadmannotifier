use std::path::PathBuf;

use crate::config::AppConfig;
use crate::db::Store;
use crate::error::Result;

pub async fn run(config_path: PathBuf, _limit: u32) -> Result<()> {
    let cfg = AppConfig::load_from_path(&config_path)?;
    let store = Store::open(&cfg.database.path)?;

    println!("\nLatest Logs by Service:");
    println!("========================");

    if cfg.services.is_empty() {
        println!("No services configured.");
        return Ok(());
    }

    let mut service_map = std::collections::HashMap::new();
    for s in &cfg.services {
        service_map.insert(s.id.clone(), s.name.clone());
    }

    let mut latest_events = Vec::new();
    for service in &cfg.services {
        if let Some(ev) = store.get_latest_event_for_service(&service.id)? {
            latest_events.push(ev);
        }
    }

    if latest_events.is_empty() {
        println!("No events found for any configured services.");
        return Ok(());
    }

    latest_events.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    for event in latest_events {
        let name = service_map
            .get(&event.service_id)
            .map(String::as_str)
            .unwrap_or("Unknown Service");
        println!(
            "{} | {:20} | {:3} | {}",
            event.timestamp,
            name,
            event.state.to_uppercase(),
            event.source_ip.as_deref().unwrap_or("unknown")
        );
        if let Some(logs) = &event.logs {
            for line in logs.lines() {
                println!("    {line}");
            }
        }
    }

    Ok(())
}
