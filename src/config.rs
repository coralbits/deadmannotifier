use std::path::Path;
use url::Url;
use uuid::Uuid;

use crate::error::{Error, Result};

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub with_cron: bool,
    pub external_url: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct DatabaseConfig {
    pub path: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct EmailConfig {
    pub from: String,
    pub to: String,
    pub subject: String,
    #[serde(default)]
    pub body: Option<String>,
    pub smtp: SmtpConfig,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ServiceEntry {
    pub id: String,
    pub name: String,
    /// Optional client or category label; used for ordering and display.
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct StatusUiConfig {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub email: EmailConfig,
    pub cron: String,
    pub services: Vec<ServiceEntry>,
    #[serde(default)]
    pub status_ui: Option<StatusUiConfig>,
}

impl AppConfig {
    pub fn load_from_path(path: impl AsRef<Path>) -> Result<Self> {
        let raw = std::fs::read_to_string(path.as_ref())?;
        let cfg: AppConfig = serde_yaml::from_str(&raw)?;
        cfg.validate()?;
        Ok(cfg)
    }

    pub fn validate(&self) -> Result<()> {
        if self.server.host.is_empty() {
            return Err(Error::Config("server.host is required".into()));
        }
        if self.server.port == 0 {
            return Err(Error::Config(
                "server.port must be between 1 and 65535".into(),
            ));
        }

        if let Some(url) = &self.server.external_url {
            if url.trim().is_empty() {
                return Err(Error::Config(
                    "server.external_url must not be empty when set".into(),
                ));
            }
            Url::parse(url)
                .map_err(|_| Error::Config("server.external_url must be a valid URL".into()))?;
        }

        if self.database.path.is_empty() {
            return Err(Error::Config("database.path is required".into()));
        }

        if self.email.from.is_empty() || self.email.to.is_empty() || self.email.subject.is_empty() {
            return Err(Error::Config(
                "email.from, email.to, and email.subject are required".into(),
            ));
        }

        if self.email.smtp.host.is_empty()
            || self.email.smtp.user.is_empty()
            || self.email.smtp.password.is_empty()
        {
            return Err(Error::Config("email.smtp fields are incomplete".into()));
        }

        if self.cron.is_empty() {
            return Err(Error::Config("cron expression is required".into()));
        }

        if self.services.is_empty() {
            return Err(Error::Config(
                "at least one service must be configured".into(),
            ));
        }

        let mut seen = std::collections::HashSet::new();
        for s in &self.services {
            if s.id.is_empty() || s.name.is_empty() {
                return Err(Error::Config("each service must have id and name".into()));
            }
            if let Some(g) = &s.group {
                if g.trim().is_empty() {
                    return Err(Error::Config(format!(
                        "service `{}`: group must not be blank when set",
                        s.name
                    )));
                }
            }
            Uuid::parse_str(&s.id).map_err(|_| {
                Error::Config(format!("invalid UUID format for service: {}", s.name))
            })?;
            if !seen.insert(&s.id) {
                return Err(Error::Config("duplicate service IDs found".into()));
            }
        }

        if let Some(ui) = &self.status_ui {
            if ui.username.is_empty() || ui.password.is_empty() {
                return Err(Error::Config(
                    "status_ui.username and status_ui.password must be non-empty when status_ui is set".into(),
                ));
            }
        }

        Ok(())
    }

    pub fn service_by_id(&self, id: &str) -> Option<&ServiceEntry> {
        self.services.iter().find(|s| s.id == id)
    }
}
