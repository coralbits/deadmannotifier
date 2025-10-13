const Database = require("../db/database");

async function logsCommand(options) {
  const { configLoader, limit } = options;

  try {
    // Initialize database
    const dbPath = configLoader.getDatabaseConfig().path;
    const db = new Database(dbPath);
    await db.init();

    // Get configured services
    const configuredServices = configLoader.getServices();

    console.log(`\nLatest Logs by Service:`);
    console.log("========================");

    if (configuredServices.length === 0) {
      console.log("No services configured.");
    } else {
      // Create a map of service ID to name for display
      const serviceMap = {};
      configuredServices.forEach((service) => {
        serviceMap[service.id] = service.name;
      });

      // Get latest event for each configured service
      const latestEvents = [];
      for (const service of configuredServices) {
        const latestEvent = await db.getLatestEventForService(service.id);
        if (latestEvent) {
          latestEvents.push(latestEvent);
        }
      }

      if (latestEvents.length === 0) {
        console.log("No events found for any configured services.");
      } else {
        // Sort by timestamp (most recent first)
        latestEvents.sort(
          (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
        );

        latestEvents.forEach((event) => {
          const serviceName = serviceMap[event.service_id] || "Unknown Service";
          const timestamp = new Date(event.timestamp).toISOString();

          console.log(
            `${timestamp} | ${serviceName.padEnd(20)} | ${event.state
              .toUpperCase()
              .padEnd(3)} | ${event.source_ip}`
          );

          if (event.logs) {
            // Display logs with proper newline handling
            const logLines = event.logs.split("\n");
            logLines.forEach((line) => {
              console.log(`    ${line}`);
            });
          }
        });
      }
    }

    await db.close();
  } catch (error) {
    console.error("Failed to get logs:", error.message);
    process.exit(1);
  }
}

module.exports = logsCommand;
