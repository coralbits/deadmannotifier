# Database reference

SQLite file path comes from `database.path` in the YAML config.

## Schema

On open, the process runs [assets/schema.sql](../assets/schema.sql) (`CREATE IF NOT EXISTS` + indexes). Existing databases created by the Node version remain compatible.

### `events`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER PK | Autoincrement |
| `service_id` | TEXT | Configured UUID or internal markers |
| `state` | TEXT | `ok`, `nok`, or `nak` (CHECK constraint) |
| `timestamp` | DATETIME | Defaults to `CURRENT_TIMESTAMP` |
| `logs` | TEXT | Optional body from `PUT` ping |
| `source_ip` | TEXT | Derived from proxy headers or `unknown` |

### `current_state`

| Column | Type | Notes |
| --- | --- | --- |
| `service_id` | TEXT PK | Configured service UUID |
| `state` | TEXT | `ok` / `nok` / `nak` |
| `last_updated` | DATETIME | Updated on each successful ping |

## Cron marker

After a successful non-test email cycle, an extra row is inserted into `events`:

- `service_id`: `cron-job-marker`
- `state`: `nak`
- `logs`: `CRON_JOB_MARKER`
- `source_ip`: `system`

This mirrors the legacy Node behavior (used for ad-hoc debugging / “last email” queries).
