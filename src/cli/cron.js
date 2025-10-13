const CronService = require("../services/cron");
const { execSync } = require("child_process");
const path = require("path");

async function cronCommand(options) {
  const { configLoader, init, test } = options;

  if (init) {
    await initCronEntry(configLoader);
    return;
  }

  try {
    console.log("Checking if cron job should run...");

    const cronService = new CronService(configLoader);

    if (test) {
      console.log("Running in test mode - email will be written to file");
      await cronService.init();
      await cronService.runTestMode();
    } else {
      await cronService.init();
      // Check if we should run the cron job and run it if needed
      await cronService.checkAndRunIfNeeded();
    }

    await cronService.close();
    console.log("Cron check completed.");
  } catch (error) {
    console.error("Failed to run cron check:", error.message);
    process.exit(1);
  }
}

async function initCronEntry(configLoader) {
  try {
    const configPathResolved = configLoader.configPath;
    const scriptPath = path.resolve(__dirname, "../../src/index.js");

    // Get the cron expression from config
    const cronExpression = configLoader.getCronConfig();

    // Create cron entry - run every minute to check if we should send email
    const cronEntry = `* * * * * cd ${path.dirname(
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
