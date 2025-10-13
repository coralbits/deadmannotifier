# Dead Man Notifier

A REST service for monitoring service health with email notifications.

## Quick Start

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure the service:**
   Edit `config.yaml` with your email settings and services.

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

- Email SMTP settings
- Cron schedule
- Service definitions with UUIDs

## Usage

Services ping the notifier with:

- `PUT /[service-id]/ok` - Service is healthy
- `PUT /[service-id]/nok` - Service has issues

The cron job sends periodic email reports and marks services as "nak" (not acknowledged) if they haven't pinged within the cron period.
