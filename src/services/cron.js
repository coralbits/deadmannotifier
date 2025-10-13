const cron = require("node-cron");
const Database = require("../db/database");
const EmailService = require("./email");
const ConfigLoader = require("./config");

class CronService {
  constructor(configPath = "config.yaml", dbPath = "deadman.db") {
    this.configPath = configPath;
    this.dbPath = dbPath;
    this.db = null;
    this.emailService = null;
    this.config = null;
    this.task = null;
  }

  async init() {
    // Load configuration
    const configLoader = new ConfigLoader(this.configPath);
    this.config = configLoader.load();
    this.configLoader = configLoader; // Store the loader instance for method access

    // Initialize database
    this.db = new Database(this.dbPath);
    await this.db.init();

    // Initialize email service
    this.emailService = new EmailService(this.configLoader.getEmailConfig());
    await this.emailService.init();
  }

  async runCronJob() {
    try {
      console.log("Running cron job...");

      // Get current states of all services
      const currentStates = await this.db.getCurrentStates();

      // Get latest events for context
      const latestEvents = await this.db.getLatestEvents(20);

      // Send email with current status
      await this.emailService.sendStatusEmail(currentStates, latestEvents);

      // Mark all services as "nak" after sending email
      await this.db.markAllServicesAsNak();

      console.log("Cron job completed successfully");
    } catch (error) {
      console.error("Cron job failed:", error);
    }
  }

  start() {
    if (this.task) {
      console.log("Cron job is already running");
      return;
    }

    const cronExpression = this.configLoader.getCronConfig();

    console.log(`Starting cron job with expression: ${cronExpression}`);

    this.task = cron.schedule(
      cronExpression,
      async () => {
        await this.runCronJob();
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    console.log("Cron job started");
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log("Cron job stopped");
    } else {
      console.log("No cron job running");
    }
  }

  async close() {
    this.stop();
    if (this.db) {
      await this.db.close();
    }
  }

  // Method to run cron job manually (for testing)
  async runNow() {
    await this.runCronJob();
  }
}

module.exports = CronService;
