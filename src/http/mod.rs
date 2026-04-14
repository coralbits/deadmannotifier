mod dashboard;
mod ping;

use std::sync::Arc;

use axum::routing::{get, put};
use axum::Router;
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;

use crate::config::AppConfig;
use crate::db::Store;

use dashboard::{redirect_root, status_dashboard};
use ping::{handle_ping_nok, handle_ping_ok};

#[derive(Clone)]
pub struct HttpState {
    pub config: Arc<RwLock<AppConfig>>,
    pub store: Store,
}

pub fn build_router(state: HttpState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/", get(redirect_root))
        .route("/status", get(status_dashboard))
        .route("/{id}/ok", put(handle_ping_ok))
        .route("/{id}/nok", put(handle_ping_nok))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}
