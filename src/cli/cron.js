const CronService = require("../services/cron");
const { execSync } = require("child_process");
const path = require("path");

async function cronCommand(options) {
  const { config, init } = options;

  if (init) {
    await initCronEntry(config);
    return;
  }

  try {
    console.log("Starting cron service...");

    const cronService = new CronService(config);
    await cronService.init();

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\nReceived SIGINT, shutting down gracefully...");
      await cronService.close();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\nReceived SIGTERM, shutting down gracefully...");
      await cronService.close();
      process.exit(0);
    });

    // Start the cron job
    cronService.start();

    // Keep the process running
    console.log("Cron service is running. Press Ctrl+C to stop.");
  } catch (error) {
    console.error("Failed to start cron service:", error.message);
    process.exit(1);
  }
}

async function initCronEntry(configPath) {
  try {
    const configPathResolved = path.resolve(configPath);
    const scriptPath = path.resolve(__dirname, "../../src/index.js");

    // Get the cron expression from config
    const ConfigLoader = require("../services/config");
    const configLoader = new ConfigLoader(configPathResolved);
    configLoader.load();
    const cronExpression = configLoader.getCronConfig();

    // Create cron entry
    const cronEntry = `${cronExpression} cd ${path.dirname(
      scriptPath
    )} && node ${scriptPath} cron -c ${configPathResolved}`;

    // Get current crontab
    let currentCrontab = "";
    try {
      currentCrontab = execSync("crontab -l", { encoding: "utf8" });
    } catch (error) {
      // No crontab exists yet, that's fine
    }

    // Check if our entry already exists
    const entryExists =
      currentCrontab.includes("deadmannotifier") ||
      currentCrontab.includes("dms cron");

    if (entryExists) {
      console.log("Cron entry for Dead Man Notifier already exists.");
      console.log("Current crontab:");
      console.log(currentCrontab);
      return;
    }

    // Add our entry
    const newCrontab =
      currentCrontab +
      (currentCrontab ? "\n" : "") +
      `# Dead Man Notifier\n${cronEntry}\n`;

    // Write new crontab
    execSync("crontab -", { input: newCrontab });

    console.log("Cron entry added successfully!");
    console.log(`Entry: ${cronEntry}`);
    console.log("\nTo verify, run: crontab -l");
  } catch (error) {
    console.error("Failed to initialize cron entry:", error.message);
    console.error("Make sure you have permission to modify crontab.");
    process.exit(1);
  }
}

module.exports = cronCommand;
