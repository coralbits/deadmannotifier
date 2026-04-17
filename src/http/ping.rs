use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::http::Method;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde_json::json;

use crate::domain::ServiceState;
use crate::error::Error;

use super::HttpState;

pub async fn method_not_allowed_json(method: Method) -> impl IntoResponse {
    (
        StatusCode::METHOD_NOT_ALLOWED,
        axum::Json(json!({
            "error": "Method not allowed",
            "message": format!("This endpoint requires PUT (you sent {method})"),
            "expected": "PUT",
            "got": method.to_string(),
        })),
    )
}

pub async fn handle_ping_ok(
    axum::extract::State(state): axum::extract::State<HttpState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> axum::response::Response {
    handle_ping(state, id, ServiceState::Ok, &headers, body).await
}

pub async fn handle_ping_nok(
    axum::extract::State(state): axum::extract::State<HttpState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> axum::response::Response {
    handle_ping(state, id, ServiceState::Nok, &headers, body).await
}

fn client_ip(headers: &HeaderMap) -> String {
    if let Some(v) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        return v.split(',').next().unwrap_or("unknown").trim().to_string();
    }
    if let Some(v) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        return v.trim().to_string();
    }
    "unknown".to_string()
}

async fn handle_ping(
    state: HttpState,
    id: String,
    ping_state: ServiceState,
    headers: &HeaderMap,
    body: Bytes,
) -> axum::response::Response {
    let service_name = {
        let cfg = state.config.read().await;
        cfg.service_by_id(&id).map(|s| s.name.clone())
    };

    let Some(service_name) = service_name else {
        return (
            StatusCode::NOT_FOUND,
            axum::Json(json!({
                "error": "Service not found",
                "serviceId": id,
            })),
        )
            .into_response();
    };

    let logs = if body.is_empty() {
        None
    } else {
        Some(String::from_utf8_lossy(&body).into_owned())
    };
    let ip = client_ip(headers);
    let store = state.store.clone();
    let sid = id.clone();
    let res = tokio::task::spawn_blocking(move || {
        store.insert_event(&sid, ping_state, logs.as_deref(), Some(ip.as_str()))?;
        store.update_current_state(&sid, ping_state)?;
        Ok::<(), Error>(())
    })
    .await;

    match res {
        Ok(Ok(())) => (
            StatusCode::OK,
            axum::Json(json!({
                "success": true,
                "service": service_name,
                "state": ping_state.as_str(),
                "timestamp": chrono::Utc::now().to_rfc3339(),
            })),
        )
            .into_response(),
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({
                "error": "Internal server error",
                "message": e.to_string(),
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({
                "error": "Internal server error",
                "message": e.to_string(),
            })),
        )
            .into_response(),
    }
}
