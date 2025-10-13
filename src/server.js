const express = require("express");
const Database = require("./db/database");
const ConfigLoader = require("./services/config");

class Server {
  constructor(configPath = "config.yaml", dbPath = "deadman.db") {
    this.configPath = configPath;
    this.dbPath = dbPath;
    this.app = express();
    this.db = null;
    this.config = null;
  }

  async init() {
    // Load configuration
    const configLoader = new ConfigLoader(this.configPath);
    this.config = configLoader.load();
    this.configLoader = configLoader; // Store the loader instance for method access

    // Initialize database
    this.db = new Database(this.dbPath);
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

  async start(port = 3000) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`Dead Man Notifier server running on port ${port}`);
          resolve();
        }
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
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
