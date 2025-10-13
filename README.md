# Dead Man Notifier

A REST service for monitoring service health with email notifications.

## Quick Start

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure the service:**
   Edit `config.yaml` with your server, database, email settings and services.

3. **Start the server:**

   ```bash
   npm start
   # or
   node src/index.js serve
   ```

4. **Test a service ping:**
   ```bash
   curl -X PUT http://localhost:3000/438c41d2-f4d8-4697-aaa6-ab7bfd02b07d/ok
   ```

## CLI Commands

- `dms serve` - Start the REST server
- `dms list` - Show current service states
- `dms logs` - Show latest events
- `dms cron` - Start cron job service
- `dms cron --init` - Setup system cron entry

### Command Line Options

All commands support the `-c, --config <path>` option to specify a custom config file:

```bash
dms serve --config /data/config.yaml
dms list --config /etc/deadman/config.yaml
dms logs --config /data/config.yaml
dms cron --config /data/config.yaml
```

The `serve` command also supports:

- `-h, --host <host>` - Override the host from config
- `-p, --port <port>` - Override the port from config
- `--with-cron` - Enable embedded cron job (overrides config setting)

```bash
dms serve --host 127.0.0.1 --port 8080
dms serve --config /data/config.yaml --host 0.0.0.0 --port 3000
dms serve --with-cron  # Enable embedded cron job
```

### Embedded Cron Service

The server can run with an embedded cron service that automatically sends status emails at the configured schedule. This can be enabled in two ways:

1. **Via config file** - Set `with_cron: true` in the server section
2. **Via command line** - Use the `--with-cron` flag

When enabled, the server will:

- Start the REST API server
- Automatically run cron jobs at the configured schedule
- Send email reports with service status
- Handle graceful shutdown of both services

## Docker

Build and run with Docker:

```bash
docker build -t deadmannotifier .
docker run -p 3000:3000 -v $(pwd)/config.yaml:/app/config.yaml deadmannotifier
```

## Testing

Run tests:

```bash
npm test
npm run test:unit
npm run test:integration
```

## Configuration

See `config.yaml` for configuration options. The file includes:

- **Server settings**: host, port, embedded cron option, and external URL
- **Database settings**: SQLite database path
- **Email SMTP settings**: SMTP server configuration for notifications
- **Cron schedule**: When to send periodic reports
- **Service definitions**: UUIDs and names for monitored services

Example configuration:

```yaml
server:
  host: "0.0.0.0"
  port: 3000
  with_cron: false # Enable embedded cron service
  external_url: "https://deadman.example.com" # Optional external URL for service pings

database:
  path: "deadman.db"

email:
  from: "alerts@example.com"
  to: "admin@example.com"
  subject: "Service Status Report"
  smtp:
    host: "smtp.example.com"
    port: 587
    user: "alerts@example.com"
    password: "your-password"

cron: "0 */6 * * *" # Every 6 hours

services:
  - id: "550e8400-e29b-41d4-a716-446655440000"
    name: "Database Backup"
  - id: "550e8400-e29b-41d4-a716-446655440001"
    name: "File Sync Service"
```

## Usage

Services ping the notifier with:

- `PUT /[service-id]/ok` - Service is healthy
- `PUT /[service-id]/nok` - Service has issues

The cron job sends periodic email reports and marks services as "nak" (not acknowledged) if they haven't pinged within the cron period.
