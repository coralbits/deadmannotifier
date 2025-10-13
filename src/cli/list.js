const Database = require("../db/database");

async function listCommand(options) {
  const { configLoader } = options;

  try {
    // Initialize database
    const dbPath = configLoader.getDatabaseConfig().path;
    const db = new Database(dbPath);
    await db.init();

    // Get configured services
    const services = configLoader.getServices();
    const serverConfig = configLoader.getServerConfig();

    // Get current states from database
    const currentStates = await db.getCurrentStates();

    // Create a map of service ID to current state for quick lookup
    const stateMap = {};
    currentStates.forEach((state) => {
      stateMap[state.service_id] = state;
    });

    console.log("\nService Status Report:");
    console.log("=====================");
    console.log(`Server: ${serverConfig.host}:${serverConfig.port}`);
    console.log("");

    if (services.length === 0) {
      console.log("No services configured.");
    } else {
      services.forEach((service) => {
        const currentState = stateMap[service.id];
        const serviceName = service.name;

        if (currentState) {
          const status = currentState.state.toUpperCase();
          const timestamp = new Date(
            currentState.last_updated
          ).toLocaleString();
          const url = `http://${serverConfig.host}:${serverConfig.port}/${service.id}/{state}`;
          console.log(
            `${serviceName.padEnd(20)} | ${status.padEnd(
              3
            )} | ${timestamp} | ${url}`
          );
        } else {
          const url = `http://${serverConfig.host}:${serverConfig.port}/${service.id}/{state}`;
          console.log(
            `${serviceName.padEnd(20)} | MISSING | No status reported | ${url}`
          );
        }
      });
    }

    await db.close();
  } catch (error) {
    console.error("Failed to list services:", error.message);
    process.exit(1);
  }
}

module.exports = listCommand;
