const Database = require("../db/database");

async function logsCommand(options) {
  const { configLoader, limit } = options;

  try {

    // Initialize database
    const dbPath = configLoader.getDatabaseConfig().path;
    const db = new Database(dbPath);
    await db.init();

    // Get latest events
    const events = await db.getLatestEvents(parseInt(limit));

    console.log(`\nLatest ${events.length} Events:`);
    console.log("========================");

    if (events.length === 0) {
      console.log("No events found.");
    } else {
        // Create a map of service ID to name for display
        const serviceMap = {};
        configLoader.getServices().forEach((service) => {
          serviceMap[service.id] = service.name;
        });

      events.forEach((event) => {
        const serviceName = serviceMap[event.service_id] || "Unknown Service";
        const timestamp = new Date(event.timestamp).toLocaleString();
        const logs = event.logs ? `\n    Logs: ${event.logs}` : "";
        console.log(
          `${timestamp} | ${serviceName.padEnd(20)} | ${event.state
            .toUpperCase()
            .padEnd(3)} | ${event.source_ip}${logs}`
        );
      });
    }

    await db.close();
  } catch (error) {
    console.error("Failed to get logs:", error.message);
    process.exit(1);
  }
}

module.exports = logsCommand;
