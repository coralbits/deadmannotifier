mod dashboard;
mod heatmap;
mod ping;

use std::sync::Arc;
use std::time::Duration;

use axum::extract::MatchedPath;
use axum::routing::{get, put};
use axum::Router;
use axum::http::header::CONTENT_LENGTH;
use axum::http::HeaderMap;
use tokio::sync::RwLock;
use tower_http::classify::{ServerErrorsAsFailures, SharedClassifier};
use tower_http::trace::TraceLayer;
use tracing::{info, info_span, Span};

use crate::config::AppConfig;
use crate::db::Store;

use dashboard::{
    redirect_root, status_dashboard, status_dashboard_group, status_day_all, status_day_group,
    status_day_service, status_service,
};
use ping::{handle_ping_nok, handle_ping_ok, method_not_allowed_json};

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
        .route("/{id}/ok", put(handle_ping_ok).fallback(method_not_allowed_json))
        .route("/{id}/nok", put(handle_ping_nok).fallback(method_not_allowed_json))
        .with_state(state)
        .layer(http_trace_layer())
}

async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

fn client_ip(headers: &HeaderMap) -> &str {
    // Prefer first hop (closest client) when behind a proxy.
    // Matches existing behavior elsewhere in the codebase.
    headers
        .get("x-forwarded-for")
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .or_else(|| headers.get("x-real-ip").and_then(|h| h.to_str().ok()))
        .unwrap_or("unknown")
}

fn content_length(headers: &HeaderMap) -> u64 {
    headers
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0)
}

fn http_trace_layer() -> TraceLayer<
    SharedClassifier<ServerErrorsAsFailures>,
    impl Fn(&axum::http::Request<axum::body::Body>) -> Span + Clone,
    tower_http::trace::DefaultOnRequest,
    impl Fn(&axum::http::Response<axum::body::Body>, Duration, &Span) + Clone,
    tower_http::trace::DefaultOnBodyChunk,
    tower_http::trace::DefaultOnEos,
    tower_http::trace::DefaultOnFailure,
> {
    TraceLayer::new_for_http()
        .make_span_with(|req: &axum::http::Request<_>| {
            let matched_path = req
                .extensions()
                .get::<MatchedPath>()
                .map(|p| p.as_str())
                .unwrap_or("<unmatched>");

            info_span!(
                "http_request",
                method = %req.method(),
                uri = %req.uri(),
                route = %matched_path,
                client_ip = %client_ip(req.headers()),
            )
        })
        .on_response(|res: &axum::http::Response<_>, latency: Duration, span: &Span| {
            let status = res.status().as_u16();
            let bytes = content_length(res.headers());
            let latency_ms = latency.as_secs_f64() * 1000.0;

            info!(
                parent: span,
                status = status,
                latency_ms = latency_ms,
                response_bytes = bytes,
                "request completed"
            );
        })
}
