use std::sync::Arc;

use axum::body::Body;
use axum::http::header::AUTHORIZATION;
use axum::http::{Request, StatusCode};
use base64::Engine;
use deadmannotifier::config::AppConfig;
use deadmannotifier::db::Store;
use deadmannotifier::http::{build_router, HttpState};
use http_body_util::BodyExt;
use tempfile::tempdir;
use tokio::sync::RwLock;
use tower::ServiceExt;

fn test_config(db_path: &std::path::Path) -> AppConfig {
    let raw = format!(
        r#"
server:
  host: "127.0.0.1"
  port: 3000
database:
  path: "{}"
email:
  from: "test@example.com"
  to: "admin@example.com"
  subject: "Test Subject"
  smtp:
    host: "smtp.example.com"
    port: 587
    user: "test@example.com"
    password: "password"
cron: "0 0 * * *"
services:
  - id: "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d"
    name: "Test Service"
    group: "AlphaGroup"
  - id: "a18c41d2-f4d8-4697-aaa6-ab7bfd02b07e"
    name: "Other Service"
status_ui:
  username: "dashuser"
  password: "dashpass"
"#,
        db_path.display()
    );
    serde_yaml::from_str(&raw).expect("valid yaml")
}

#[tokio::test]
async fn get_health() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("t.db");
    let cfg = test_config(&db);
    cfg.validate().unwrap();
    let store = Store::open(&db).unwrap();
    let state = HttpState {
        config: Arc::new(RwLock::new(cfg)),
        store,
    };
    let app = build_router(state);

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn put_ok_and_not_found() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("t2.db");
    let cfg = test_config(&db);
    let store = Store::open(&db).unwrap();
    let state = HttpState {
        config: Arc::new(RwLock::new(cfg)),
        store,
    };
    let app = build_router(state);

    let sid = "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d";
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/{sid}/ok"))
                .header("content-type", "text/plain")
                .body(Body::from("Test logs"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["success"], true);
    assert_eq!(v["service"], "Test Service");
    assert_eq!(v["state"], "ok");

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/00000000-0000-0000-0000-000000000000/ok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

fn basic_auth_header(user: &str, pass: &str) -> String {
    let creds = format!("{user}:{pass}");
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(creds.as_bytes())
    )
}

#[tokio::test]
async fn status_dashboard_auth_and_heatmap() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("t3.db");
    let cfg = test_config(&db);
    cfg.validate().unwrap();
    let store = Store::open(&db).unwrap();
    let state = HttpState {
        config: Arc::new(RwLock::new(cfg)),
        store,
    };
    let app = build_router(state);

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/status")
                .header(AUTHORIZATION, basic_auth_header("dashuser", "dashpass"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let html = String::from_utf8_lossy(&body);
    assert!(html.contains("Activity"));
    assert!(html.contains("heatmap"));
}

#[tokio::test]
async fn status_group_filter_and_unknown_404() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("t4.db");
    let cfg = test_config(&db);
    cfg.validate().unwrap();
    let store = Store::open(&db).unwrap();
    let state = HttpState {
        config: Arc::new(RwLock::new(cfg)),
        store,
    };
    let app = build_router(state);

    let auth = basic_auth_header("dashuser", "dashpass");

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/status/group/NoSuchGroup")
                .header(AUTHORIZATION, &auth)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/status/group/AlphaGroup")
                .header(AUTHORIZATION, &auth)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let html = String::from_utf8_lossy(&body);
    assert!(html.contains("Test Service"));
    assert!(html.contains("AlphaGroup"));
    assert!(!html.contains("Other Service"));
    assert!(html.contains("All services"));
}
