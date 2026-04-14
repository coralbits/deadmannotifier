use askama::Template;
use lettre::message::{header::ContentType, Message, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::AsyncSmtpTransport;
use lettre::AsyncTransport;
use lettre::Tokio1Executor;

use crate::config::EmailConfig;
use crate::cron_logic::CronServiceStatus;
use crate::db::EventRow;
use crate::domain::ServiceState;
use crate::error::{Error, Result};

#[derive(Template)]
#[template(path = "email.html", escape = "html")]
pub struct EmailTemplate<'a> {
    pub subject: &'a str,
    pub timestamp: &'a str,
    pub services: Vec<EmailServiceRow<'a>>,
    pub logs: Vec<EmailLogRow<'a>>,
    pub has_logs: bool,
    pub worst_state: &'a str,
}

pub struct EmailServiceRow<'a> {
    pub name: &'a str,
    pub state: &'a str,
    pub last_updated: &'a str,
    pub is_nak: bool,
}

pub struct EmailLogRow<'a> {
    pub service_name: &'a str,
    pub state: &'a str,
    pub timestamp: &'a str,
    pub logs: Option<&'a str>,
}

pub fn worst_state_from_services(services: &[CronServiceStatus]) -> ServiceState {
    crate::cron_logic::worst_state_for_cron(services)
}

pub fn build_email_html(
    email_cfg: &EmailConfig,
    services: &[CronServiceStatus],
    events: &[EventRow],
    names: &std::collections::HashMap<String, String>,
) -> Result<(String, String)> {
    let worst = worst_state_from_services(services);
    let worst_label = match worst {
        ServiceState::Ok => "OK",
        ServiceState::Nok => "NOK",
        ServiceState::Nak => "NAK",
    };
    let subject = format!("[{}] {}", worst_label, email_cfg.subject);

    let timestamp = chrono::Utc::now().to_rfc3339();

    let svc_rows: Vec<EmailServiceRow<'_>> = services
        .iter()
        .map(|s| {
            let name = names
                .get(&s.service_id)
                .map(String::as_str)
                .unwrap_or("Unknown Service");
            EmailServiceRow {
                name,
                state: s.state.as_str(),
                last_updated: &s.last_updated,
                is_nak: s.state == ServiceState::Nak,
            }
        })
        .collect();

    let log_rows: Vec<EmailLogRow<'_>> = events
        .iter()
        .map(|e| {
            let service_name = names
                .get(&e.service_id)
                .map(String::as_str)
                .unwrap_or("Unknown Service");
            EmailLogRow {
                service_name,
                state: e.state.as_str(),
                timestamp: &e.timestamp,
                logs: e.logs.as_deref(),
            }
        })
        .collect();

    let has_logs = !log_rows.is_empty();

    let tpl = EmailTemplate {
        subject: &subject,
        timestamp: &timestamp,
        services: svc_rows,
        logs: log_rows,
        has_logs,
        worst_state: worst_label,
    };

    let html = tpl.render().map_err(|e| Error::Email(e.to_string()))?;
    Ok((subject, html))
}

pub async fn send_status_email(email_cfg: &EmailConfig, html: &str, subject: &str) -> Result<()> {
    let creds = Credentials::new(email_cfg.smtp.user.clone(), email_cfg.smtp.password.clone());

    let mailer = if email_cfg.smtp.port == 465 {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&email_cfg.smtp.host)
            .map_err(|e| Error::Email(e.to_string()))?
            .credentials(creds)
            .port(email_cfg.smtp.port)
            .build()
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&email_cfg.smtp.host)
            .map_err(|e| Error::Email(e.to_string()))?
            .credentials(creds)
            .port(email_cfg.smtp.port)
            .build()
    };

    let html_part = SinglePart::builder()
        .header(ContentType::TEXT_HTML)
        .body(html.to_string());

    let email = Message::builder()
        .from(
            email_cfg
                .from
                .parse()
                .map_err(|e| Error::Email(format!("invalid from: {e}")))?,
        )
        .to(email_cfg
            .to
            .parse()
            .map_err(|e| Error::Email(format!("invalid to: {e}")))?)
        .subject(subject)
        .singlepart(html_part)
        .map_err(|e| Error::Email(e.to_string()))?;

    mailer
        .send(email)
        .await
        .map_err(|e| Error::Email(e.to_string()))?;
    Ok(())
}

pub async fn write_email_preview_file(html: &str) -> Result<std::path::PathBuf> {
    let dir = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".into());
    let ts = chrono::Utc::now().to_rfc3339().replace([':', '.'], "-");
    let path = std::path::PathBuf::from(dir).join(format!("deadman-test-email-{ts}.html"));
    tokio::fs::write(&path, html).await?;
    Ok(path)
}
