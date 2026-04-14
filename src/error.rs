use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("configuration: {0}")]
    Config(String),

    #[error("database: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),

    #[error("YAML: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("email: {0}")]
    Email(String),

    #[error("cron: {0}")]
    Cron(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;
