use std::path::PathBuf;

use crate::config::AppConfig;
use crate::db::Store;
use crate::error::Result;

pub async fn run(config_path: PathBuf) -> Result<()> {
    let cfg = AppConfig::load_from_path(&config_path)?;
    let store = Store::open(&cfg.database.path)?;

    let current = store.get_current_states()?;
    let mut state_map = std::collections::HashMap::new();
    for row in current {
        state_map.insert(row.service_id.clone(), row);
    }

    let base_url = cfg
        .server
        .external_url
        .clone()
        .unwrap_or_else(|| format!("http://{}:{}", cfg.server.host, cfg.server.port));

    println!("\nService Status Report:");
    println!("=====================");
    println!("{}:{}", cfg.server.host, cfg.server.port);
    if let Some(ext) = &cfg.server.external_url {
        println!("External URL: {ext}");
    }
    println!();

    if cfg.services.is_empty() {
        println!("No services configured.");
        return Ok(());
    }

    for service in &cfg.services {
        let url = format!("{}/{}/ok", base_url.trim_end_matches('/'), service.id);
        if let Some(st) = state_map.get(&service.id) {
            println!(
                "{:20} | {:3} | {} | {}",
                service.name,
                st.state.to_uppercase(),
                st.last_updated,
                url
            );
        } else {
            println!(
                "{:20} | MISSING | No status reported | {}",
                service.name, url
            );
        }
    }

    Ok(())
}
