use chrono::Utc;

use crate::config::{AppConfig, ServiceEntry};
use crate::db::{CurrentStateRow, EventRow, Store};
use crate::domain::{worst_state, ServiceState};
use crate::error::Result;

#[derive(Debug, Clone)]
pub struct CronServiceStatus {
    pub service_id: String,
    pub state: ServiceState,
    pub last_updated: String,
}

#[derive(Debug, Clone)]
pub struct CronData {
    pub services: Vec<CronServiceStatus>,
    pub events: Vec<EventRow>,
}

/// Builds the same service/event snapshot the Node cron used for email and console output.
pub fn gather_cron_data(config: &AppConfig, store: &Store) -> Result<CronData> {
    let configured = &config.services;
    let current_states = store.get_current_states()?;
    let state_map: std::collections::HashMap<String, CurrentStateRow> = current_states
        .into_iter()
        .map(|r| (r.service_id.clone(), r))
        .collect();

    let mut services = Vec::new();
    let mut events = Vec::new();

    for service in configured {
        if let Some(current) = state_map.get(&service.id) {
            let st = ServiceState::parse(&current.state).unwrap_or(ServiceState::Nak);
            services.push(CronServiceStatus {
                service_id: service.id.clone(),
                state: st,
                last_updated: current.last_updated.clone(),
            });
            if let Some(ev) = store.get_latest_event_for_service(&service.id)? {
                events.push(ev);
            }
        } else {
            services.push(CronServiceStatus {
                service_id: service.id.clone(),
                state: ServiceState::Nak,
                last_updated: Utc::now().to_rfc3339(),
            });
        }
    }

    let order: std::collections::HashMap<String, (u8, String, String, String)> = configured
        .iter()
        .map(|e| (e.id.clone(), service_sort_key(e)))
        .collect();
    services.sort_by(|a, b| order[&a.service_id].cmp(&order[&b.service_id]));
    events.sort_by(|a, b| order[&a.service_id].cmp(&order[&b.service_id]));

    Ok(CronData { services, events })
}

/// Sort: non-empty `group` first (alphabetically by group, then name), ungrouped last.
pub fn service_sort_key(entry: &ServiceEntry) -> (u8, String, String, String) {
    let label = entry
        .group
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match label {
        Some(g) => (
            0,
            g.to_lowercase(),
            entry.name.to_lowercase(),
            entry.id.clone(),
        ),
        None => (
            1,
            String::new(),
            entry.name.to_lowercase(),
            entry.id.clone(),
        ),
    }
}

pub fn service_name_map(config: &AppConfig) -> std::collections::HashMap<String, String> {
    config
        .services
        .iter()
        .map(|s| (s.id.clone(), s.name.clone()))
        .collect()
}

/// Service id → trimmed group label (only entries that have a non-empty `group`).
pub fn service_group_map(config: &AppConfig) -> std::collections::HashMap<String, String> {
    config
        .services
        .iter()
        .filter_map(|s| {
            let g = s.group.as_deref()?.trim();
            if g.is_empty() {
                None
            } else {
                Some((s.id.clone(), g.to_string()))
            }
        })
        .collect()
}

pub fn worst_state_for_cron(services: &[CronServiceStatus]) -> ServiceState {
    worst_state(services.iter().map(|s| s.state))
}
