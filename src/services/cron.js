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

    // Get database path from config if not provided
    const dbPath = this.dbPath || this.configLoader.getDatabaseConfig().path;

    // Initialize database
    this.db = new Database(dbPath);
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

      // Output results to stdout
      console.log("\n=== DEAD MAN NOTIFIER REPORT ===");
      console.log(`Generated on: ${new Date().toLocaleString()}`);
      console.log("\nService Status Summary:");
      console.log("========================");

      if (currentStates.length === 0) {
        console.log("No services have reported status yet.");
      } else {
        // Create a map of service ID to name for display
        const serviceMap = {};
        this.configLoader.getServices().forEach((service) => {
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

      if (latestEvents.length > 0) {
        console.log("\nRecent Logs:");
        console.log("============");

        // Create a map of service ID to name for display
        const serviceMap = {};
        this.configLoader.getServices().forEach((service) => {
          serviceMap[service.id] = service.name;
        });

        latestEvents.forEach((event) => {
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

      // Determine worst state
      const worstState = this.getWorstState(currentStates);
      console.log(`\nWorst state detected: ${worstState.toUpperCase()}`);
      console.log("========================\n");

      // Send email with current status
      await this.emailService.sendStatusEmail(currentStates, latestEvents);

      // Mark all services as "nak" after sending email
      await this.db.markAllServicesAsNak();

      console.log("Cron job completed successfully");
    } catch (error) {
      console.error("Cron job failed:", error);
    }
  }

  getWorstState(services) {
    if (!services || services.length === 0) {
      return "nak";
    }

    const states = services.map((s) => s.state);

    if (states.includes("nak")) {
      return "nak";
    } else if (states.includes("nok")) {
      return "nok";
    } else {
      return "ok";
    }
  }

  async checkAndRunIfNeeded() {
    try {
      const cronExpression = this.configLoader.getCronConfig();

      console.log(`Cron expression: ${cronExpression}`);

      // Always run for testing purposes
      console.log("Running cron job (always run mode for testing)...");
      await this.runCronJob();
      await this.updateLastEmailTime();
    } catch (error) {
      console.error("Cron check failed:", error);
    }
  }

  async getLastEmailTime() {
    try {
      // Get the timestamp of the last event that was a cron job (we'll use a special marker)
      return new Promise((resolve, reject) => {
        this.db.db.get(
          "SELECT timestamp FROM events WHERE logs LIKE '%CRON_JOB_MARKER%' ORDER BY timestamp DESC LIMIT 1",
          (err, result) => {
            if (err) {
              console.error("Error getting last email time:", err);
              resolve(new Date(0));
            } else if (result) {
              resolve(new Date(result.timestamp));
            } else {
              // If no previous cron job found, return a very old date to trigger first run
              resolve(new Date(0));
            }
          }
        );
      });
    } catch (error) {
      console.error("Error getting last email time:", error);
      return new Date(0);
    }
  }

  async updateLastEmailTime() {
    try {
      // Insert a special event to mark when the cron job ran
      await this.db.insertEvent(
        "cron-job-marker",
        "nak",
        "CRON_JOB_MARKER",
        "system"
      );
    } catch (error) {
      console.error("Error updating last email time:", error);
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
        await this.updateLastEmailTime();
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
    await this.updateLastEmailTime();
  }
}

module.exports = CronService;
