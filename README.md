# Dead Man Notifier

Rust service for monitoring backup and automation jobs with SQLite storage, optional email reports, and an optional password-protected HTML status page.

## Requirements

- Rust toolchain (stable), or use the provided Dockerfile.

## Quick start

```bash
cargo build --release
./target/release/dms serve --config config.yaml
```

Ping a configured service (replace UUID with one from your `config.yaml`):

```bash
curl -X PUT http://localhost:3000/438c41d2-f4d8-4697-aaa6-ab7bfd02b07d/ok
```

Send logs with a file (preserves newlines):

```bash
curl -X PUT http://localhost:3000/438c41d2-f4d8-4697-aaa6-ab7bfd02b07d/ok --data-binary @logfile.txt
```

## CLI (`dms`)

| Command     | Description                                                      |
| ----------- | ---------------------------------------------------------------- |
| `dms serve` | HTTP server (`GET /health`, `PUT /{uuid}/ok`, `PUT /{uuid}/nok`; optional `/` → `/status` dashboard) |
| `dms list`  | Print configured services and last known state                   |
| `dms logs`  | Latest stored event per configured service                       |
| `dms cron`  | Run one report cycle (email + reset) or `--init` / `--test`      |

Global option: `-c, --config <path>` (default `config.yaml`).

`serve` options:

- `-H, --host` — bind host (overrides config)
- `-p, --port` — bind port (overrides config)
- `--with-cron` — force embedded cron on for this process (initial load only)
- `--watch` — watch the config file; reload on change and restart embedded cron when enabled

Note: `-h` is reserved for help; use `-H` or `--host` for the host override (differs from the old Node CLI).

## Configuration (`config.yaml`)

The server reads a single YAML file (default `config.yaml`, override with `-c` / `--config`). It must define:

- **`server`**: `host`, `port`; optional `with_cron`, `external_url`
- **`database`**: `path` to the SQLite file
- **`email`**: `from`, `to`, `subject`, and `smtp` (`host`, `port`, `user`, `password`)
- **`cron`**: schedule string for embedded reports (when `with_cron` is enabled)
- **`services`**: list of `{ id: <UUID>, name: <string> }` for each monitored job

Optional fields such as `email.body` are accepted for compatibility but ignored unless documented elsewhere.

Full field reference: [docs/CONFIG.md](docs/CONFIG.md).

## Web dashboard (status UI)

When **`status_ui`** is configured with both **`username`** and **`password`**, the HTTP server exposes a small **HTML dashboard** (monospace, high-contrast layout) that lists every configured service with its current state, last update time, and a one-line preview of the latest stored log.

**URLs and auth**

1. Open **`http://<host>:<port>/`** in a browser (same host/port as `server` in YAML, or your reverse proxy).
2. The server responds with **`302`** to **`/status`** (no credentials required for that redirect).
3. **`GET /status`** is protected with **HTTP Basic authentication**. The browser then prompts for **username** and **password**; these must match `status_ui.username` and `status_ui.password` in your config file.

If `status_ui` is omitted or either field is empty, **`GET /`** and **`GET /status`** return **404** (you still have `/health` and the ping routes).

With **`dms serve --watch`**, a successful config reload updates the in-memory YAML. **Username, password, and turning the dashboard on or off** are read from that config on **each request**, so changes to `status_ui` apply immediately after reload (no process restart).

**Minimal `status_ui` block** (add at the top level of `config.yaml`, next to `server` / `email`):

```yaml
status_ui:
  username: "admin"
  password: "use-a-strong-secret"
```

Use a dedicated non-production password in repos; prefer secrets injection or a private config file in production. See also [AGENTS.md](AGENTS.md) (security notes).

## Docker

```bash
docker build -t deadmannotifier .
# or
make docker-build
```

Run (see [run.sh](run.sh)): the container copies the example config into `/app/data/config.yaml` on first start and runs `dms serve --config /app/data/config.yaml --watch`.

## Testing

```bash
cargo test
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
```

## Documentation

- [PROGRESS.md](PROGRESS.md) — migration and feature checklist
- [AGENTS.md](AGENTS.md) — notes for future development
- [docs/CONFIG.md](docs/CONFIG.md) — configuration reference
- [docs/DATABASE.md](docs/DATABASE.md) — SQLite schema and semantics

## License

MIT — see [LICENSE.md](LICENSE.md).
