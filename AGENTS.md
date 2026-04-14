# AGENTS — development notes

Concise facts for future work on this repository.

## Layout

| Path                                                                        | Role                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [src/main.rs](src/main.rs)                                                  | `clap` entrypoint                                              |
| [src/lib.rs](src/lib.rs)                                                    | Library root and `commands` modules                            |
| [src/config.rs](src/config.rs)                                              | YAML structs + validation                                      |
| [src/db.rs](src/db.rs)                                                      | SQLite access (`rusqlite`, same schema as the old Node app)    |
| [src/domain.rs](src/domain.rs)                                              | `ServiceState`, worst-state ordering                           |
| [src/cron_logic.rs](src/cron_logic.rs)                                      | Pure “gather report snapshot” logic                            |
| [src/cron_runner.rs](src/cron_runner.rs)                                    | Console report, email/test mode, NAK reset, cron marker insert |
| [src/email.rs](src/email.rs) + [templates/email.html](templates/email.html) | HTML email                                                     |
| [src/http/](src/http/)                                                      | Axum router, ping handlers; `/` → `/status`, dashboard + Basic auth on `/status`; optional `GET /status/group/{group}` and `…/group/{group}/day/{day}` (percent-encoded segment, trim match on configured `services[].group`) |
| [src/embedded_cron.rs](src/embedded_cron.rs)                                | `tokio-cron-scheduler` job                                     |
| [src/watcher.rs](src/watcher.rs)                                            | `notify` debounced config reload                               |
| [assets/schema.sql](assets/schema.sql)                                      | Idempotent DDL executed on open                                |

## Cron semantics (important)

1. **Embedded cron** (when `server.with_cron` is true): runs on the YAML `cron` expression. The scheduler uses **six** fields (`sec min hour dom mon dow`). A **five**-field expression from the old Node config is normalized by prepending `0 ` (seconds = 0), matching typical `node-cron` minute-first schedules.
2. **Standalone `dms cron`** (no `--test`): each invocation runs the **full** report cycle (email, mark all services NAK in `current_state`, insert marker row). This matches the previous Node `checkAndRunIfNeeded` behavior.
3. **`dms cron --init`**: installs a **per-minute** host crontab line invoking `dms cron -c <config>`. Combined with (2), that can mean **very frequent** emails if SMTP is live. This is historical parity; operators may want to change the crontab line after `--init`.

Marker row: `events.service_id = 'cron-job-marker'`, `logs = 'CRON_JOB_MARKER'`, `state = 'nak'`, `source_ip = 'system'`.

## HTTP / client IP

`ConnectInfo` is not used with `Router` state in Axum 0.8 the same way as with `Router<()>`. Client IP for pings is taken from `X-Forwarded-For` (first hop) or `X-Real-Ip`, else stored as `unknown`.

## Dashboard and config reload

`GET /` and `GET /status` read **`status_ui` from `HttpState.config` (`Arc<RwLock<AppConfig>>`)** on every request. With `serve --watch`, after a successful file reload, updated **username/password** and **enabling or disabling** the block apply without restarting the process.

## CLI vs old Node

- Host short flag is **`-H`** (not `-h`), because `-h` is help.
- Binary name remains **`dms`**.

## Security

- Passwords live in YAML (SMTP + optional `status_ui`) as before; prefer secrets management or env injection for production.
- Dashboard uses constant-time comparison for Basic credentials (`subtle`).

## Updating [PROGRESS.md](PROGRESS.md)

When finishing a planned item or changing operator-visible behavior, update the checklist and “Maintenance” section in `PROGRESS.md` in the same change set when practical.
