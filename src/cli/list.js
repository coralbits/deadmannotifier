const Database = require("../db/database");
const ConfigLoader = require("../services/config");

async function listCommand(options) {
  const { config } = options;

  try {
    // Load configuration
    const configLoader = new ConfigLoader(config);
    const configData = configLoader.load();

    // Initialize database
    const db = new Database();
    await db.init();

    // Get current states
    const currentStates = await db.getCurrentStates();

    console.log("\nCurrent Service States:");
    console.log("======================");

    if (currentStates.length === 0) {
      console.log("No services have reported status yet.");
    } else {
      // Create a map of service ID to name for display
      const serviceMap = {};
      configData.getServices().forEach((service) => {
        serviceMap[service.id] = service.name;
      });

      currentStates.forEach((state) => {
        const serviceName = serviceMap[state.service_id] || "Unknown Service";
        const timestamp = new Date(state.last_updated).toLocaleString();
        console.log(
          `${serviceName.padEnd(20)} | ${state.state
            .toUpperCase()
            .padEnd(3)} | ${timestamp}`
        );
      });
    }

    await db.close();
  } catch (error) {
    console.error("Failed to list services:", error.message);
    process.exit(1);
  }
}

module.exports = listCommand;
