mod dashboard;
mod heatmap;
mod ping;

use std::sync::Arc;

use axum::routing::{get, put};
use axum::Router;
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;

use crate::config::AppConfig;
use crate::db::Store;

use dashboard::{
    redirect_root, status_dashboard, status_dashboard_group, status_day_all, status_day_group,
    status_day_service, status_service,
};
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
        .route("/status/service/{sid}/day/{day}", get(status_day_service))
        .route("/status/service/{sid}", get(status_service))
        .route("/status/group/{group}/day/{day}", get(status_day_group))
        .route("/status/group/{group}", get(status_dashboard_group))
        .route("/status/day/{day}", get(status_day_all))
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
