const express = require("express");
const Database = require("./db/database");
const ConfigLoader = require("./services/config");
const CronService = require("./services/cron");

class Server {
  constructor(configLoader) {
    this.configLoader = configLoader;
    this.app = express();
    this.db = null;
    this.config = null;
    this.cronService = null;
  }

  async init() {
    // Use the passed configLoader
    this.config = this.configLoader.load();

    // Get database path from config
    const dbPath = this.configLoader.getDatabaseConfig().path;

    // Initialize database
    this.db = new Database(dbPath);
    await this.db.init();

    // Setup middleware
    this.app.use(express.text({ type: "*/*" }));
    this.app.use(express.json());

    // Setup routes
    this.setupRoutes();

    // Error handling middleware
    this.app.use(this.errorHandler);
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Service ping endpoints
    this.app.put("/:id/ok", this.handlePing.bind(this, "ok"));
    this.app.put("/:id/nok", this.handlePing.bind(this, "nok"));
  }

  async handlePing(state, req, res) {
    try {
      const serviceId = req.params.id;
      const logs = req.body || null;
      const sourceIp = req.ip || req.connection.remoteAddress || "unknown";

      // Validate service ID exists in config
      const service = this.configLoader.getServiceById(serviceId);
      if (!service) {
        return res.status(404).json({
          error: "Service not found",
          serviceId: serviceId,
        });
      }

      // Store event in database
      await this.db.insertEvent(serviceId, state, logs, sourceIp);

      // Update current state
      await this.db.updateCurrentState(serviceId, state);

      console.log(
        `Service ${service.name} (${serviceId}) pinged with state: ${state}`
      );

      res.json({
        success: true,
        service: service.name,
        state: state,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error handling ping:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error.message,
      });
    }
  }

  errorHandler(err, req, res, next) {
    console.error("Unhandled error:", err);
    res.status(500).json({
      error: "Internal server error",
      message: err.message,
    });
  }

  async startEmbeddedCron() {
    try {
      const serverConfig = this.configLoader.getServerConfig();
      if (serverConfig.with_cron) {
        console.log("Starting embedded cron service...");
        this.cronService = new CronService(this.configLoader);
        await this.cronService.init();
        this.cronService.start();
        console.log("Embedded cron service started");
      }
    } catch (error) {
      console.error("Failed to start embedded cron service:", error);
    }
  }

  async stopEmbeddedCron() {
    if (this.cronService) {
      console.log("Stopping embedded cron service...");
      await this.cronService.close();
      this.cronService = null;
      console.log("Embedded cron service stopped");
    }
  }

  async start(port = null, host = null, withCron = null) {
    await this.init();

    // Use config values if not provided
    const serverConfig = this.configLoader.getServerConfig();
    const serverPort = port || serverConfig.port;
    const serverHost = host || serverConfig.host;

    // Override with_cron from CLI if provided
    if (withCron !== null) {
      serverConfig.with_cron = withCron;
    }

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(serverPort, serverHost, async (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(
            `Dead Man Notifier server running on ${serverHost}:${serverPort}`
          );

          // Start embedded cron if enabled
          if (serverConfig.with_cron) {
            await this.startEmbeddedCron();
          }

          resolve();
        }
      });
    });
  }

  async stop() {
    return new Promise(async (resolve) => {
      // Stop embedded cron first
      await this.stopEmbeddedCron();

      if (this.server) {
        this.server.close(() => {
          console.log("Server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  async close() {
    await this.stop();
    if (this.db) {
      await this.db.close();
    }
  }
}

module.exports = Server;
