use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};
use tracing::{error, info};

use crate::config::AppConfig;
use crate::db::Store;
use crate::embedded_cron::EmbeddedCron;
use crate::error::Result;
use crate::http::{build_router, HttpState};
use crate::watcher::watch_config_file;

pub struct ServeOptions {
    pub config: PathBuf,
    pub host: Option<String>,
    pub port: Option<u16>,
    /// When `Some(true)`, forces `server.with_cron = true` for the initial config (matches Node `--with-cron`).
    pub with_cron_cli: Option<bool>,
    pub watch: bool,
}

async fn restart_embedded_cron(
    slot: &Mutex<Option<EmbeddedCron>>,
    cfg: &Arc<RwLock<AppConfig>>,
    store: Store,
) -> Result<()> {
    let mut guard = slot.lock().await;
    if let Some(c) = guard.take() {
        c.shutdown().await?;
    }
    let snap = cfg.read().await.clone();
    if snap.server.with_cron {
        *guard = Some(EmbeddedCron::start(&snap.cron, store, cfg.clone()).await?);
        info!("embedded cron service started");
    } else {
        info!("embedded cron disabled by configuration");
    }
    Ok(())
}

pub async fn run(opts: ServeOptions) -> Result<()> {
    let path = std::fs::canonicalize(&opts.config).unwrap_or_else(|_| opts.config.clone());

    let mut cfg = AppConfig::load_from_path(&path)?;
    if opts.with_cron_cli == Some(true) {
        cfg.server.with_cron = true;
    }
    if let Some(h) = opts.host.clone() {
        cfg.server.host = h;
    }
    if let Some(p) = opts.port {
        cfg.server.port = p;
    }

    let cfg = Arc::new(RwLock::new(cfg));
    let store = Store::open(cfg.read().await.database.path.as_str())?;

    let cron_slot: Arc<Mutex<Option<EmbeddedCron>>> = Arc::new(Mutex::new(None));
    restart_embedded_cron(&cron_slot, &cfg, store.clone()).await?;

    let state = HttpState {
        config: cfg.clone(),
        store: store.clone(),
    };
    let app = build_router(state);

    let bind_host = cfg.read().await.server.host.clone();
    let bind_port = cfg.read().await.server.port;

    let mut addrs = tokio::net::lookup_host((bind_host.as_str(), bind_port))
        .await
        .map_err(|e| crate::error::Error::Other(e.to_string()))?;
    let addr = addrs
        .next()
        .ok_or_else(|| crate::error::Error::Other("no bind addresses resolved".into()))?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("Dead Man Notifier listening on {addr}");

    if opts.watch {
        let watch_path = path.clone();
        let cfg_w = cfg.clone();
        let store_w = store.clone();
        let cron_w = cron_slot.clone();
        let handle = tokio::runtime::Handle::current();
        tokio::spawn(async move {
            let res = watch_config_file(watch_path.clone(), move || {
                let cfg_w = cfg_w.clone();
                let cron_w = cron_w.clone();
                let store_w = store_w.clone();
                let p = watch_path.clone();
                handle.spawn(async move {
                    match AppConfig::load_from_path(&p) {
                        Ok(new_cfg) => {
                            *cfg_w.write().await = new_cfg;
                            if let Err(e) =
                                restart_embedded_cron(&cron_w, &cfg_w, store_w.clone()).await
                            {
                                error!("failed to restart embedded cron after reload: {e}");
                            } else {
                                info!("config reloaded successfully");
                            }
                        }
                        Err(e) => error!("failed to reload config: {e}"),
                    }
                });
            })
            .await;
            if let Err(e) = res {
                error!("config watcher exited: {e}");
            }
        });
    }

    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
        info!("shutdown signal received");
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .map_err(|e| crate::error::Error::Other(e.to_string()))?;

    let mut guard = cron_slot.lock().await;
    if let Some(c) = guard.take() {
        c.shutdown().await?;
    }

    Ok(())
}
