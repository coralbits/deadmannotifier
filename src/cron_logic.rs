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

    Ok(CronData { services, events })
}

pub fn service_name_map(config: &AppConfig) -> std::collections::HashMap<String, String> {
    config
        .services
        .iter()
        .map(|ServiceEntry { id, name }| (id.clone(), name.clone()))
        .collect()
}

pub fn worst_state_for_cron(services: &[CronServiceStatus]) -> ServiceState {
    worst_state(services.iter().map(|s| s.state))
}
