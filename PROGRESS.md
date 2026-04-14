# Progress — Dead Man Notifier (Rust)

Track major milestones here; update this file when phases complete.

## Done

- [x] Rust crate with `dms` binary (`serve`, `list`, `logs`, `cron`)
- [x] YAML config loading and validation (parity + optional `status_ui`)
- [x] SQLite store compatible with existing schema ([assets/schema.sql](assets/schema.sql))
- [x] HTTP API: `GET /health`, `PUT /{id}/ok`, `PUT /{id}/nok`, JSON response shapes
- [x] Email HTML reports (Askama + lettre SMTP) and cron job semantics (including marker event)
- [x] Embedded cron (`server.with_cron` / `--with-cron`) with UTC schedule (5-field cron normalized to 6-field)
- [x] Config file watch (`serve --watch`) with debounced reload and embedded cron restart
- [x] Optional Basic-auth dashboard at `GET /`
- [x] Integration tests (`tests/http_integration.rs`), unit test for worst-state ordering
- [x] GitHub Actions (fmt, clippy, test), Dockerfile, Makefile, docker-compose
- [x] Removal of Node.js implementation and npm artifacts

## Maintenance

- [ ] Optional: gate standalone `dms cron` on schedule instead of “always run” (would be a behavior change; see [AGENTS.md](AGENTS.md))
- [ ] Optional: restore `ConnectInfo` / client IP when Axum serving API stabilizes for typed state routers
