const cron = require("node-cron");
const Database = require("../db/database");
const EmailService = require("./email");
const ConfigLoader = require("./config");

class CronService {
  constructor(configLoader) {
    this.configLoader = configLoader;
    this.db = null;
    this.emailService = null;
    this.config = null;
    this.task = null;
  }

  async init() {
    // Use the passed configLoader
    this.config = this.configLoader.load();

    // Get database path from config
    const dbPath = this.configLoader.getDatabaseConfig().path;

    // Initialize database
    this.db = new Database(dbPath);
    await this.db.init();

    // Initialize email service
    this.emailService = new EmailService(this.configLoader.getEmailConfig());
    await this.emailService.init();
  }

  async runCronJob(testMode = false) {
    try {
      console.log("Running cron job...");

      // Get all configured services
      const configuredServices = this.configLoader.getServices();

      // Get current states of all services that have reported
      const currentStates = await this.db.getCurrentStates();

      // Create a map of service ID to current state
      const stateMap = {};
      currentStates.forEach((state) => {
        stateMap[state.service_id] = state;
      });

      // Build complete service list including missing services
      const allServices = [];
      const latestEvents = [];

      for (const service of configuredServices) {
        const currentState = stateMap[service.id];

        if (currentState) {
          // Service has reported, use its current state
          allServices.push({
            service_id: service.id,
            state: currentState.state,
            last_updated: currentState.last_updated,
          });

          // Get latest event for this service
          const latestEvent = await this.db.getLatestEventForService(
            service.id
          );
          if (latestEvent) {
            latestEvents.push(latestEvent);
          }
        } else {
          // Service has never reported, mark as nak
          allServices.push({
            service_id: service.id,
            state: "nak",
            last_updated: new Date().toISOString(), // Use current time for missing services
          });
        }
      }

      // Output results to stdout
      console.log("\n=== DEAD MAN NOTIFIER REPORT ===");
      console.log(`Generated on: ${new Date().toISOString()}`);
      console.log("\nService Status Summary:");
      console.log("========================");

      if (allServices.length === 0) {
        console.log("No services configured.");
      } else {
        // Create a map of service ID to name for display
        const serviceMap = {};
        this.configLoader.getServices().forEach((service) => {
          serviceMap[service.id] = service.name;
        });

        allServices.forEach((state) => {
          const serviceName = serviceMap[state.service_id] || "Unknown Service";
          const timestamp = new Date(state.last_updated).toISOString();
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
          const timestamp = new Date(event.timestamp).toISOString();
          const logs = event.logs ? `\n    Logs: ${event.logs}` : "";
          console.log(
            `${timestamp} | ${serviceName.padEnd(20)} | ${event.state
              .toUpperCase()
              .padEnd(3)} | ${event.source_ip}${logs}`
          );
        });
      }

      // Determine worst state
      const worstState = this.getWorstState(allServices);
      console.log(`\nWorst state detected: ${worstState.toUpperCase()}`);
      console.log("========================\n");

      if (testMode) {
        await this.writeEmailToFile(allServices, latestEvents);
      } else {
        await this.sendEmailAndResetServices(allServices, latestEvents);
      }

      console.log("Cron job completed successfully");
    } catch (error) {
      console.error("Cron job failed:", error);
    }
  }

  async writeEmailToFile(allServices, latestEvents) {
    // Transform data for email service
    const serviceMap = {};
    this.configLoader.getServices().forEach((service) => {
      serviceMap[service.id] = service.name;
    });

    const servicesForEmail = allServices.map((state) => ({
      name: serviceMap[state.service_id] || "Unknown Service",
      state: state.state,
      last_updated: state.last_updated,
    }));

    const logsForEmail = latestEvents.map((event) => ({
      service_name: serviceMap[event.service_id] || "Unknown Service",
      state: event.state,
      timestamp: event.timestamp,
      logs: event.logs,
    }));

    // Generate email content
    const emailContent = await this.emailService.generateEmailContent(
      servicesForEmail,
      logsForEmail
    );

    // Write email to temporary file
    const fs = require("fs");
    const path = require("path");
    const tempDir = process.env.TMPDIR || "/tmp";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tempFile = path.join(tempDir, `deadman-test-email-${timestamp}.html`);

    fs.writeFileSync(tempFile, emailContent, "utf8");

    const fileUrl = `file://${tempFile}`;
    console.log(`Email content written to: ${fileUrl}`);
    console.log(`You can open this file in your browser to preview the email.`);
    console.log(`\nNote: Services were NOT reset to NAK status in test mode.`);
  }

  async sendEmailAndResetServices(allServices, latestEvents) {
    // Send email with current status
    await this.emailService.sendStatusEmail(allServices, latestEvents);

    // Mark all services as "nak" after sending email
    await this.db.markAllServicesAsNak();
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

  async runTestMode() {
    await this.runCronJob(true);
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
