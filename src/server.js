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
    this._cronService = null;
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

    // Request logging middleware
    this.app.use(this.requestLogger);

    // Setup routes
    this.setupRoutes();

    // Error handling middleware
    this.app.use(this.errorHandler);
  }

  requestLogger(req, res, next) {
    const start = Date.now();
    const timestamp = new Date().toISOString();

    // Get client IP (considering proxies)
    const clientIp =
      req.ip ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
      "unknown";

    // Get user agent
    const userAgent = req.get("User-Agent") || "unknown";

    // Log the request
    console.log(
      `[${timestamp}] ${req.method} ${req.originalUrl} - ${clientIp} - ${userAgent}`
    );

    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function (chunk, encoding) {
      const duration = Date.now() - start;
      const statusCode = res.statusCode;
      const statusColor =
        statusCode >= 500
          ? "\x1b[31m" // red for 5xx
          : statusCode >= 400
          ? "\x1b[33m" // yellow for 4xx
          : statusCode >= 300
          ? "\x1b[36m" // cyan for 3xx
          : "\x1b[32m"; // green for 2xx
      const resetColor = "\x1b[0m";

      console.log(
        `${statusColor}[${timestamp}] ${req.method} ${req.originalUrl} - ${statusCode} - ${duration}ms${resetColor}`
      );

      originalEnd.call(this, chunk, encoding);
    };

    next();
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
        this._cronService = new CronService(this.configLoader);
        await this._cronService.init();
        this._cronService.start();
        console.log("Embedded cron service started");
      }
    } catch (error) {
      console.error("Failed to start embedded cron service:", error);
    }
  }

  async stopEmbeddedCron() {
    if (this._cronService) {
      console.log("Stopping embedded cron service...");
      await this._cronService.close();
      this._cronService = null;
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

  // Getter for cronService to allow external access
  get cronService() {
    return this._cronService;
  }

  set cronService(value) {
    this._cronService = value;
  }
}

module.exports = Server;
