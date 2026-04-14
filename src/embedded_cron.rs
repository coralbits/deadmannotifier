use std::sync::Arc;

use tokio::sync::RwLock;
use tokio_cron_scheduler::{Job, JobScheduler};

use crate::config::AppConfig;
use crate::cron_runner::run_cron_job;
use crate::db::Store;
use crate::error::{Error, Result};

pub struct EmbeddedCron {
    scheduler: JobScheduler,
}

impl EmbeddedCron {
    pub async fn start(
        cron_expr: &str,
        store: Store,
        config: Arc<RwLock<AppConfig>>,
    ) -> Result<Self> {
        let schedule = normalize_schedule(cron_expr);
        let scheduler = JobScheduler::new()
            .await
            .map_err(|e| Error::Cron(e.to_string()))?;

        let store_c = store.clone();
        let cfg_c = config.clone();
        let job = Job::new_async(schedule.as_str(), move |_uuid, _lock| {
            let store = store_c.clone();
            let cfg_c = cfg_c.clone();
            Box::pin(async move {
                let cfg = cfg_c.read().await.clone();
                if let Err(e) = run_cron_job(&store, &cfg, false).await {
                    tracing::error!("embedded cron job failed: {e}");
                }
            })
        })
        .map_err(|e| Error::Cron(format!("invalid cron schedule `{cron_expr}`: {e}")))?;

        scheduler
            .add(job)
            .await
            .map_err(|e| Error::Cron(e.to_string()))?;

        scheduler
            .start()
            .await
            .map_err(|e| Error::Cron(e.to_string()))?;

        Ok(Self { scheduler })
    }

    pub async fn shutdown(mut self) -> Result<()> {
        self.scheduler
            .shutdown()
            .await
            .map_err(|e| Error::Cron(e.to_string()))?;
        Ok(())
    }
}

/// Converts a 5-field cron (minute hour dom mon dow) to 6-field (sec min hour dom mon dow) used by
/// `tokio-cron-scheduler`, matching the previous Node `node-cron` interpretation.
pub fn normalize_schedule(expr: &str) -> String {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() == 5 {
        format!("0 {}", parts.join(" "))
    } else {
        expr.to_string()
    }
}
