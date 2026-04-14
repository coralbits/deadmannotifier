use askama::Template;
use axum::extract::{Path, State};
use axum::http::header::{AUTHORIZATION, WWW_AUTHENTICATE};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use base64::Engine;
use chrono::NaiveDate;
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::cron_logic::{gather_cron_data, service_name_map};
use crate::db::{EventRow, Store};

use super::heatmap;
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

async fn status_credentials(state: &HttpState) -> Option<(String, String)> {
    let cfg = state.config.read().await;
    cfg.status_ui.as_ref().and_then(|ui| {
        if ui.username.is_empty() || ui.password.is_empty() {
            None
        } else {
            Some((ui.username.clone(), ui.password.clone()))
        }
    })
}

fn unauthorized_status() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [(
            WWW_AUTHENTICATE,
            axum::http::HeaderValue::from_static("Basic realm=\"status\""),
        )],
        "Unauthorized",
    )
        .into_response()
}

fn html_ok(body: String) -> Response {
    (
        StatusCode::OK,
        [(
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static("text/html; charset=utf-8"),
        )],
        body,
    )
        .into_response()
}

fn parse_calendar_day(day: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()
}

fn service_configured(config: &AppConfig, service_id: &str) -> bool {
    config.services.iter().any(|s| s.id == service_id)
}

fn parse_service_path(config: &AppConfig, sid: &str) -> Option<String> {
    Uuid::parse_str(sid).ok()?;
    if service_configured(config, sid) {
        Some(sid.to_string())
    } else {
        None
    }
}

#[derive(Template)]
#[template(path = "dashboard.html", escape = "html")]
struct DashboardTemplate {
    pub generated_at: String,
    pub heatmap: heatmap::HeatmapGrid,
    pub rows: Vec<DashboardRow>,
}

#[derive(Template)]
#[template(path = "dashboard_service.html", escape = "html")]
struct DashboardServiceTemplate {
    pub generated_at: String,
    pub service_name: String,
    pub service_id: String,
    pub heatmap: heatmap::HeatmapGrid,
}

#[derive(Template)]
#[template(path = "dashboard_day.html", escape = "html")]
struct DashboardDayTemplate {
    pub day: String,
    pub back_href: String,
    pub subtitle: String,
    pub heatmap: heatmap::HeatmapGrid,
    pub events: Vec<DayLogRow>,
}

pub struct DashboardRow {
    pub service_id: String,
    pub name: String,
    pub state: String,
    pub last_updated: String,
    pub log_preview: String,
}

pub struct DayLogRow {
    pub timestamp: String,
    pub service_id: String,
    pub service_name: String,
    pub state: String,
    pub source_ip: String,
    pub logs: String,
}

pub async fn status_dashboard(State(state): State<HttpState>, headers: HeaderMap) -> Response {
    let Some((user, pass)) = status_credentials(&state).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !basic_authorized(&headers, &user, &pass) {
        return unauthorized_status();
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

    html_ok(html)
}

pub async fn status_service(
    State(state): State<HttpState>,
    Path(sid): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some((user, pass)) = status_credentials(&state).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !basic_authorized(&headers, &user, &pass) {
        return unauthorized_status();
    }

    let cfg = state.config.read().await.clone();
    if parse_service_path(&cfg, &sid).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }

    let store = state.store.clone();
    let sid_owned = sid.clone();
    let html =
        match tokio::task::spawn_blocking(move || render_service_page(&store, &cfg, &sid_owned))
            .await
        {
            Ok(Ok(h)) => h,
            Ok(Err(e)) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to build service page: {e}"),
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

    html_ok(html)
}

pub async fn status_day_all(
    State(state): State<HttpState>,
    Path(day): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some((user, pass)) = status_credentials(&state).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !basic_authorized(&headers, &user, &pass) {
        return unauthorized_status();
    }
    if parse_calendar_day(&day).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }

    let cfg = state.config.read().await.clone();
    let store = state.store.clone();
    let day_owned = day.clone();
    let html = match tokio::task::spawn_blocking(move || {
        render_day_page(&store, &cfg, &day_owned, None, "/status", "All services")
    })
    .await
    {
        Ok(Ok(h)) => h,
        Ok(Err(e)) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to build day page: {e}"),
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

    html_ok(html)
}

pub async fn status_day_service(
    State(state): State<HttpState>,
    Path((sid, day)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let Some((user, pass)) = status_credentials(&state).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !basic_authorized(&headers, &user, &pass) {
        return unauthorized_status();
    }
    if parse_calendar_day(&day).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }

    let cfg = state.config.read().await.clone();
    if parse_service_path(&cfg, &sid).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }

    let store = state.store.clone();
    let sid_owned = sid.clone();
    let day_owned = day.clone();
    let back = format!("/status/service/{sid_owned}");
    let names = service_name_map(&cfg);
    let subtitle = names
        .get(&sid_owned)
        .cloned()
        .unwrap_or_else(|| "Service".to_string());

    let html = match tokio::task::spawn_blocking(move || {
        render_day_page(
            &store,
            &cfg,
            &day_owned,
            Some(sid_owned.as_str()),
            &back,
            &subtitle,
        )
    })
    .await
    {
        Ok(Ok(h)) => h,
        Ok(Err(e)) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to build day page: {e}"),
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

    html_ok(html)
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

fn overview_heatmap(
    store: &Store,
    config: &AppConfig,
) -> crate::error::Result<heatmap::HeatmapGrid> {
    let (range_start, range_end) = heatmap::heatmap_range_utc();
    let from = range_start.format("%Y-%m-%d").to_string();
    let to = range_end.format("%Y-%m-%d").to_string();
    let events = store.get_events_between_calendar_days(&from, &to, None)?;
    let worst = heatmap::worst_state_by_day(&events);
    let names = service_name_map(config);
    let tips = heatmap::build_overview_day_tips(&events, &names, range_start, range_end, &worst);
    Ok(heatmap::build_heatmap_grid(
        &worst,
        range_start,
        range_end,
        |d| format!("/status/day/{}", d.format("%Y-%m-%d")),
        move |d| {
            tips.get(&d)
                .cloned()
                .unwrap_or_else(|| heatmap::tip_fallback(d))
        },
    ))
}

fn service_heatmap(store: &Store, service_id: &str) -> crate::error::Result<heatmap::HeatmapGrid> {
    let (range_start, range_end) = heatmap::heatmap_range_utc();
    let from = range_start.format("%Y-%m-%d").to_string();
    let to = range_end.format("%Y-%m-%d").to_string();
    let events = store.get_events_between_calendar_days(&from, &to, Some(service_id))?;
    let worst = heatmap::worst_state_by_day(&events);
    let worst_owned = worst.clone();
    let sid = service_id.to_string();
    Ok(heatmap::build_heatmap_grid(
        &worst,
        range_start,
        range_end,
        move |d| format!("/status/service/{}/day/{}", sid, d.format("%Y-%m-%d")),
        move |d| heatmap::service_day_tip(d, worst_owned.get(&d).copied()),
    ))
}

fn render_dashboard(store: &Store, config: &AppConfig) -> crate::error::Result<String> {
    let data = gather_cron_data(config, store)?;
    let names = service_name_map(config);
    let heatmap = overview_heatmap(store, config)?;

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
            service_id: s.service_id.clone(),
            name,
            state: s.state.as_str().to_string(),
            last_updated: s.last_updated.clone(),
            log_preview: preview,
        });
    }

    let tpl = DashboardTemplate {
        generated_at: chrono::Utc::now().to_rfc3339(),
        heatmap,
        rows,
    };
    tpl.render()
        .map_err(|e| crate::error::Error::Other(e.to_string()))
}

fn render_service_page(
    store: &Store,
    config: &AppConfig,
    sid: &str,
) -> crate::error::Result<String> {
    let names = service_name_map(config);
    let service_name = names
        .get(sid)
        .cloned()
        .unwrap_or_else(|| "Unknown".to_string());
    let heatmap = service_heatmap(store, sid)?;

    let tpl = DashboardServiceTemplate {
        generated_at: chrono::Utc::now().to_rfc3339(),
        service_name,
        service_id: sid.to_string(),
        heatmap,
    };
    tpl.render()
        .map_err(|e| crate::error::Error::Other(e.to_string()))
}

fn event_to_day_row(ev: &EventRow, names: &std::collections::HashMap<String, String>) -> DayLogRow {
    let service_name = names
        .get(&ev.service_id)
        .cloned()
        .unwrap_or_else(|| ev.service_id.clone());
    DayLogRow {
        timestamp: ev.timestamp.clone(),
        service_id: ev.service_id.clone(),
        service_name,
        state: ev.state.clone(),
        source_ip: ev.source_ip.clone().unwrap_or_else(|| "—".to_string()),
        logs: ev.logs.clone().unwrap_or_default(),
    }
}

fn render_day_page(
    store: &Store,
    config: &AppConfig,
    day: &str,
    service_id: Option<&str>,
    back_href: &str,
    subtitle: &str,
) -> crate::error::Result<String> {
    let names = service_name_map(config);
    let raw = store.get_events_on_calendar_day(day, service_id)?;
    let events: Vec<DayLogRow> = raw.iter().map(|e| event_to_day_row(e, &names)).collect();

    let heatmap = match service_id {
        Some(sid) => service_heatmap(store, sid)?,
        None => overview_heatmap(store, config)?,
    };

    let tpl = DashboardDayTemplate {
        day: day.to_string(),
        back_href: back_href.to_string(),
        subtitle: subtitle.to_string(),
        heatmap,
        events,
    };
    tpl.render()
        .map_err(|e| crate::error::Error::Other(e.to_string()))
}
