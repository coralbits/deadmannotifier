use std::path::Path;
use std::sync::Arc;

use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::ServiceState;
use crate::error::{Error, Result};

const SCHEMA: &str = include_str!("../assets/schema.sql");

#[derive(Debug, Clone)]
pub struct EventRow {
    pub id: i64,
    pub service_id: String,
    pub state: String,
    pub timestamp: String,
    pub logs: Option<String>,
    pub source_ip: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CurrentStateRow {
    pub service_id: String,
    pub state: String,
    pub last_updated: String,
}

fn event_row_from_sql(r: &rusqlite::Row<'_>) -> rusqlite::Result<EventRow> {
    Ok(EventRow {
        id: r.get(0)?,
        service_id: r.get(1)?,
        state: r.get(2)?,
        timestamp: r.get(3)?,
        logs: r.get(4)?,
        source_ip: r.get(5)?,
    })
}

#[derive(Clone)]
pub struct Store {
    inner: Arc<std::sync::Mutex<Connection>>,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self {
            inner: Arc::new(std::sync::Mutex::new(conn)),
        })
    }

    pub fn insert_event(
        &self,
        service_id: &str,
        state: ServiceState,
        logs: Option<&str>,
        source_ip: Option<&str>,
    ) -> Result<i64> {
        let sql = "
            INSERT INTO events (service_id, state, logs, source_ip)
            VALUES (?1, ?2, ?3, ?4)
        ";
        let conn = self
            .inner
            .lock()
            .map_err(|_| Error::Other("database connection mutex poisoned".into()))?;
        conn.execute(
            sql,
            params![
                service_id,
                state.as_str(),
                logs,
                source_ip.unwrap_or("unknown")
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_current_state(&self, service_id: &str, state: ServiceState) -> Result<usize> {
        let sql = "
            INSERT OR REPLACE INTO current_state (service_id, state, last_updated)
            VALUES (?1, ?2, CURRENT_TIMESTAMP)
        ";
        let conn = self
            .inner
            .lock()
            .map_err(|_| Error::Other("database connection mutex poisoned".into()))?;
        Ok(conn.execute(sql, params![service_id, state.as_str()])?)
    }

    pub fn get_current_states(&self) -> Result<Vec<CurrentStateRow>> {
        let conn = self
            .inner
            .lock()
            .map_err(|_| Error::Other("database connection mutex poisoned".into()))?;
        let mut stmt = conn.prepare(
            "SELECT service_id, state, last_updated FROM current_state ORDER BY service_id",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(CurrentStateRow {
                    service_id: r.get(0)?,
                    state: r.get(1)?,
                    last_updated: r.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_latest_events(&self, limit: u32) -> Result<Vec<EventRow>> {
        let conn = self
            .inner
            .lock()
            .map_err(|_| Error::Other("database connection mutex poisoned".into()))?;
        let mut stmt = conn.prepare(
            "SELECT id, service_id, state, timestamp, logs, source_ip FROM events ORDER BY timestamp DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(EventRow {
                    id: r.get(0)?,
                    service_id: r.get(1)?,
                    state: r.get(2)?,
                    timestamp: r.get(3)?,
                    logs: r.get(4)?,
                    source_ip: r.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_latest_event_for_service(&self, service_id: &str) -> Result<Option<EventRow>> {
        let conn = self
            .inner
            .lock()
            .map_err(|_| Error::Other("database connection mutex poisoned".into()))?;
        let mut stmt = conn.prepare(
            "SELECT id, service_id, state, timestamp, logs, source_ip FROM events WHERE service_id = ?1 ORDER BY timestamp DESC LIMIT 1",
        )?;
        Ok(stmt
            .query_row(params![service_id], |r| {
                Ok(EventRow {
                    id: r.get(0)?,
                    service_id: r.get(1)?,
                    state: r.get(2)?,
                    timestamp: r.get(3)?,
                    logs: r.get(4)?,
                    source_ip: r.get(5)?,
                })
            })
            .optional()?)
    }

    /// Events with `date(timestamp)` in `[from_day, to_day]` inclusive (YYYY-MM-DD, UTC calendar).
    /// Excludes `cron-job-marker` rows. If `service_id` is set, filter to that service only.
    pub fn get_events_between_calendar_days(
        &self,
        from_day: &str,
        to_day: &str,
        service_id: Option<&str>,
    ) -> Result<Vec<EventRow>> {
        let conn = self
            .inner
            .lock()
            .map_err(|_| Error::Other("database connection mutex poisoned".into()))?;
        let out: Vec<EventRow> = if let Some(sid) = service_id {
            let mut stmt = conn.prepare(
                "SELECT id, service_id, state, timestamp, logs, source_ip FROM events
             WHERE date(timestamp) >= date(?1) AND date(timestamp) <= date(?2)
             AND service_id != 'cron-job-marker'
             AND service_id = ?3
             ORDER BY timestamp ASC",
            )?;
            let rows: Vec<EventRow> = stmt
                .query_map(params![from_day, to_day, sid], event_row_from_sql)?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, service_id, state, timestamp, logs, source_ip FROM events
             WHERE date(timestamp) >= date(?1) AND date(timestamp) <= date(?2)
             AND service_id != 'cron-job-marker'
             ORDER BY timestamp ASC",
            )?;
            let rows: Vec<EventRow> = stmt
                .query_map(params![from_day, to_day], event_row_from_sql)?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };
        Ok(out)
    }

    /// All events on a calendar day (`YYYY-MM-DD`), ordered by time.
    pub fn get_events_on_calendar_day(
        &self,
        day: &str,
        service_id: Option<&str>,
    ) -> Result<Vec<EventRow>> {
        let conn = self
            .inner
            .lock()
            .map_err(|_| Error::Other("database connection mutex poisoned".into()))?;
        let out: Vec<EventRow> = if let Some(sid) = service_id {
            let mut stmt = conn.prepare(
                "SELECT id, service_id, state, timestamp, logs, source_ip FROM events
             WHERE date(timestamp) = date(?1)
             AND service_id != 'cron-job-marker'
             AND service_id = ?2
             ORDER BY timestamp ASC",
            )?;
            let rows: Vec<EventRow> = stmt
                .query_map(params![day, sid], event_row_from_sql)?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, service_id, state, timestamp, logs, source_ip FROM events
             WHERE date(timestamp) = date(?1)
             AND service_id != 'cron-job-marker'
             ORDER BY timestamp ASC",
            )?;
            let rows: Vec<EventRow> = stmt
                .query_map(params![day], event_row_from_sql)?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };
        Ok(out)
    }

    pub fn mark_all_services_as_nak(&self) -> Result<usize> {
        let sql = "
            UPDATE current_state
            SET state = 'nak', last_updated = CURRENT_TIMESTAMP
        ";
        let conn = self
            .inner
            .lock()
            .map_err(|_| Error::Other("database connection mutex poisoned".into()))?;
        Ok(conn.execute(sql, [])?)
    }
}
