use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
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
