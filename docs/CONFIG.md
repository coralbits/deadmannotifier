# Configuration reference

Configuration is YAML. The file path defaults to `config.yaml`; override with `-c` / `--config` on any `dms` subcommand.

## Top-level keys

### `server`

| Field | Required | Description |
| --- | --- | --- |
| `host` | yes | Bind address (string; resolved with `lookup_host`) |
| `port` | yes | TCP port (1–65535) |
| `with_cron` | no | If true, start embedded scheduler in `dms serve` |
| `external_url` | no | Base URL shown in `dms list` (must be a valid URL if set) |

### `database`

| Field | Required | Description |
| --- | --- | --- |
| `path` | yes | SQLite file path (directories created if missing) |

### `email`

| Field | Required | Description |
| --- | --- | --- |
| `from`, `to`, `subject` | yes | SMTP message fields |
| `body` | no | Ignored by the server (accepted for backward-compatible YAML) |
| `smtp.host`, `smtp.port`, `smtp.user`, `smtp.password` | yes | SMTP relay settings |

### `cron`

String expression. For embedded scheduling, five fields (`min hour dom mon dow`) are accepted and normalized to six fields for `tokio-cron-scheduler` by prefixing `0 ` (seconds).

### `services`

Non-empty list of objects:

- `id`: UUID string (validated)
- `name`: display name

Duplicate `id` values are rejected.

### `status_ui` (optional)

If **both** `username` and `password` are set:

- `GET /` returns **302** to `/status` (no authentication on the redirect itself).
- `GET /status` serves the HTML dashboard and requires **HTTP Basic** credentials matching `status_ui`.

If omitted or incomplete, `GET /` and `GET /status` return **404**. With `dms serve --watch`, changes to `status_ui` take effect on the next request after a successful config reload (credentials are not cached in the router).

## Example

See [config.yaml](../config.yaml) in the repository root.
