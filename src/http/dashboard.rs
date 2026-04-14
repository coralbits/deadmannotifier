use askama::Template;
use axum::extract::State;
use axum::http::header::{AUTHORIZATION, WWW_AUTHENTICATE};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use base64::Engine;
use subtle::ConstantTimeEq;

use crate::config::AppConfig;
use crate::cron_logic::{gather_cron_data, service_name_map};
use crate::db::Store;

use super::HttpState;

/// `GET /` — redirects to `/status` only when `status_ui` is enabled in the current config (so reload can enable it).
pub async fn redirect_root(State(state): State<HttpState>) -> Response {
    let enabled = state
        .config
        .read()
        .await
        .status_ui
        .as_ref()
        .is_some_and(|ui| !ui.username.is_empty() && !ui.password.is_empty());
    if enabled {
        Redirect::temporary("/status").into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

fn basic_authorized(headers: &HeaderMap, expected_user: &str, expected_pass: &str) -> bool {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|v| validate_basic(v, expected_user, expected_pass))
        .unwrap_or(false)
}

fn validate_basic(header_value: &str, expected_user: &str, expected_pass: &str) -> bool {
    let encoded = match header_value.strip_prefix("Basic ") {
        Some(rest) => rest.trim(),
        None => return false,
    };
    let decoded = match base64::engine::general_purpose::STANDARD.decode(encoded) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    let decoded = match String::from_utf8(decoded) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let (user, pass) = match decoded.split_once(':') {
        Some(parts) => parts,
        None => return false,
    };
    ct_eq_str(expected_user, user) && ct_eq_str(expected_pass, pass)
}

fn ct_eq_str(expected: &str, actual: &str) -> bool {
    let e = expected.as_bytes();
    let a = actual.as_bytes();
    if e.len() != a.len() {
        return false;
    }
    e.ct_eq(a).into()
}

#[derive(Template)]
#[template(path = "dashboard.html", escape = "html")]
struct DashboardTemplate {
    pub generated_at: String,
    pub rows: Vec<DashboardRow>,
}

pub struct DashboardRow {
    pub name: String,
    pub state: String,
    pub last_updated: String,
    pub log_preview: String,
}

pub async fn status_dashboard(State(state): State<HttpState>, headers: HeaderMap) -> Response {
    let (user, pass) = {
        let cfg = state.config.read().await;
        match cfg.status_ui.as_ref() {
            Some(ui) if !ui.username.is_empty() && !ui.password.is_empty() => {
                (ui.username.clone(), ui.password.clone())
            }
            _ => return StatusCode::NOT_FOUND.into_response(),
        }
    };

    if !basic_authorized(&headers, &user, &pass) {
        return (
            StatusCode::UNAUTHORIZED,
            [(
                WWW_AUTHENTICATE,
                axum::http::HeaderValue::from_static("Basic realm=\"status\""),
            )],
            "Unauthorized",
        )
            .into_response();
    }

    let cfg = state.config.read().await.clone();
    let store = state.store.clone();
    let html = match tokio::task::spawn_blocking(move || render_dashboard(&store, &cfg)).await {
        Ok(Ok(h)) => h,
        Ok(Err(e)) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to build status page: {e}"),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Task join error: {e}"),
            )
                .into_response();
        }
    };

    (
        StatusCode::OK,
        [(
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static("text/html; charset=utf-8"),
        )],
        html,
    )
        .into_response()
}

fn clamp_preview(s: &str) -> String {
    let mut it = s.chars();
    let chunk: String = it.by_ref().take(120).collect();
    if it.next().is_some() {
        format!("{chunk}…")
    } else {
        chunk
    }
}

fn render_dashboard(store: &Store, config: &AppConfig) -> crate::error::Result<String> {
    let data = gather_cron_data(config, store)?;
    let names = service_name_map(config);

    let mut rows = Vec::new();
    for s in &data.services {
        let name = names
            .get(&s.service_id)
            .cloned()
            .unwrap_or_else(|| "Unknown".into());
        let preview = store
            .get_latest_event_for_service(&s.service_id)?
            .and_then(|e| e.logs)
            .map(|l| {
                let one = l.lines().next().unwrap_or("").trim();
                clamp_preview(one)
            })
            .unwrap_or_default();

        rows.push(DashboardRow {
            name,
            state: s.state.as_str().to_string(),
            last_updated: s.last_updated.clone(),
            log_preview: preview,
        });
    }

    let tpl = DashboardTemplate {
        generated_at: chrono::Utc::now().to_rfc3339(),
        rows,
    };
    tpl.render()
        .map_err(|e| crate::error::Error::Other(e.to_string()))
}
