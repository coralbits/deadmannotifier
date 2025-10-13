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

      // Gather all necessary data
      const cronData = await this.gatherCronData();

      // Generate and display report
      this.displayReport(cronData);

      // Send email or write to file
      if (testMode) {
        await this.writeEmailToFile(cronData.services, cronData.events);
      } else {
        await this.sendEmailAndResetServices(
          cronData.services,
          cronData.events
        );
      }

      console.log("Cron job completed successfully");
    } catch (error) {
      console.error("Cron job failed:", error);
    }
  }

  /**
   * Gathers all data needed for cron job processing
   * @returns {Object} Object containing services, events, and service map
   */
  async gatherCronData() {
    const configuredServices = this.configLoader.getServices();
    const currentStates = await this.db.getCurrentStates();

    // Create maps for efficient lookup
    const stateMap = this.createStateMap(currentStates);
    const serviceMap = this.createServiceMap(configuredServices);

    // Build complete service list and gather events
    const { services, events } = await this.buildServiceList(
      configuredServices,
      stateMap
    );

    return {
      services,
      events,
      serviceMap,
      configuredServices,
    };
  }

  /**
   * Creates a map of service ID to current state
   * @param {Array} currentStates - Array of current state objects
   * @returns {Object} Map of service ID to state
   */
  createStateMap(currentStates) {
    const stateMap = {};
    currentStates.forEach((state) => {
      stateMap[state.service_id] = state;
    });
    return stateMap;
  }

  /**
   * Creates a map of service ID to service name
   * @param {Array} configuredServices - Array of configured services
   * @returns {Object} Map of service ID to service name
   */
  createServiceMap(configuredServices) {
    const serviceMap = {};
    configuredServices.forEach((service) => {
      serviceMap[service.id] = service.name;
    });
    return serviceMap;
  }

  /**
   * Builds the complete service list including missing services
   * @param {Array} configuredServices - Array of configured services
   * @param {Object} stateMap - Map of service ID to current state
   * @returns {Object} Object containing services array and events array
   */
  async buildServiceList(configuredServices, stateMap) {
    const services = [];
    const events = [];

    for (const service of configuredServices) {
      const currentState = stateMap[service.id];

      if (currentState) {
        // Service has reported, use its current state
        services.push({
          service_id: service.id,
          state: currentState.state,
          last_updated: currentState.last_updated,
        });

        // Get latest event for this service (with complete logs)
        const latestEvent = await this.db.getLatestEventForService(service.id);
        if (latestEvent) {
          events.push(latestEvent);
        }
      } else {
        // Service has never reported, mark as nak
        services.push({
          service_id: service.id,
          state: "nak",
          last_updated: new Date().toISOString(),
        });
      }
    }

    return { services, events };
  }

  /**
   * Displays the cron job report to console
   * @param {Object} cronData - Object containing services, events, and service map
   */
  displayReport(cronData) {
    const { services, events, serviceMap } = cronData;

    console.log("\n=== DEAD MAN NOTIFIER REPORT ===");
    console.log(`Generated on: ${new Date().toISOString()}`);

    this.displayServiceStatus(services, serviceMap);
    this.displayRecentLogs(events, serviceMap);

    const worstState = this.getWorstState(services);
    console.log(`\nWorst state detected: ${worstState.toUpperCase()}`);
    console.log("========================\n");
  }

  /**
   * Displays service status summary
   * @param {Array} services - Array of service states
   * @param {Object} serviceMap - Map of service ID to service name
   */
  displayServiceStatus(services, serviceMap) {
    console.log("\nService Status Summary:");
    console.log("========================");

    if (services.length === 0) {
      console.log("No services configured.");
      return;
    }

    services.forEach((state) => {
      const serviceName = serviceMap[state.service_id] || "Unknown Service";
      const timestamp = new Date(state.last_updated).toISOString();
      console.log(
        `${serviceName.padEnd(20)} | ${state.state
          .toUpperCase()
          .padEnd(3)} | ${timestamp}`
      );
    });
  }

  /**
   * Displays recent logs with proper newline handling
   * @param {Array} events - Array of recent events
   * @param {Object} serviceMap - Map of service ID to service name
   */
  displayRecentLogs(events, serviceMap) {
    if (events.length === 0) {
      return;
    }

    console.log("\nRecent Logs:");
    console.log("============");

    events.forEach((event) => {
      const serviceName = serviceMap[event.service_id] || "Unknown Service";
      const timestamp = new Date(event.timestamp).toISOString();

      console.log(
        `${timestamp} | ${serviceName.padEnd(20)} | ${event.state
          .toUpperCase()
          .padEnd(3)} | ${event.source_ip}`
      );

      if (event.logs) {
        // Display logs with proper newline handling (complete logs, not cropped)
        const logLines = event.logs.split("\n");
        logLines.forEach((line) => {
          console.log(`    ${line}`);
        });
      }
    });
  }

  async writeEmailToFile(services, events) {
    // Transform data for email service using service map from config
    const serviceMap = this.createServiceMap(this.configLoader.getServices());

    const servicesForEmail = services.map((state) => ({
      name: serviceMap[state.service_id] || "Unknown Service",
      state: state.state,
      last_updated: state.last_updated,
    }));

    const logsForEmail = events.map((event) => ({
      service_name: serviceMap[event.service_id] || "Unknown Service",
      state: event.state,
      timestamp: event.timestamp,
      logs: event.logs, // Complete logs, not cropped
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

  async sendEmailAndResetServices(services, events) {
    // Send email with current status using service map from config
    const serviceMap = this.createServiceMap(this.configLoader.getServices());

    const servicesForEmail = services.map((state) => ({
      name: serviceMap[state.service_id] || "Unknown Service",
      state: state.state,
      last_updated: state.last_updated,
    }));

    const logsForEmail = events.map((event) => ({
      service_name: serviceMap[event.service_id] || "Unknown Service",
      state: event.state,
      timestamp: event.timestamp,
      logs: event.logs, // Complete logs, not cropped
    }));

    await this.emailService.sendStatusEmail(servicesForEmail, logsForEmail);

    // Mark all services as "nak" after sending email
    await this.db.markAllServicesAsNak();
    console.log("All services marked as NAK after email sent");
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
