-- SQLite schema for Dead Man Notifier
-- Events table - stores all ping events
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('ok', 'nok', 'nak')),
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    logs TEXT,
    source_ip TEXT
);

-- Current state table - stores current state of each service
CREATE TABLE IF NOT EXISTS current_state (
    service_id TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('ok', 'nok', 'nak')),
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_events_service_id ON events(service_id);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

CREATE INDEX IF NOT EXISTS idx_current_state_last_updated ON current_state(last_updated);