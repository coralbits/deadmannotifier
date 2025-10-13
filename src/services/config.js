const fs = require("fs");
const yaml = require("js-yaml");
const path = require("path");

class ConfigLoader {
  constructor(configPath = "config.yaml") {
    this.configPath = configPath;
    this.config = null;
  }

  load() {
    try {
      const configFile = fs.readFileSync(this.configPath, "utf8");
      this.config = yaml.load(configFile);
      this.validate();
      return this.config;
    } catch (error) {
      throw new Error(
        `Failed to load config from ${this.configPath}: ${error.message}`
      );
    }
  }

  validate() {
    if (!this.config) {
      throw new Error("Config is null or undefined");
    }

    // Validate server configuration
    if (!this.config.server) {
      throw new Error("Server configuration is required");
    }

    const requiredServerFields = ["host", "port"];
    for (const field of requiredServerFields) {
      if (!this.config.server[field]) {
        throw new Error(
          `Server configuration missing required field: ${field}`
        );
      }
    }

    // Validate port is a number
    const port = parseInt(this.config.server.port);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error("Server port must be a number between 1 and 65535");
    }
    // Convert port to number if it was parsed as string
    this.config.server.port = port;

    // Validate with_cron is boolean if present
    if (
      this.config.server.with_cron !== undefined &&
      typeof this.config.server.with_cron !== "boolean"
    ) {
      throw new Error("Server with_cron must be a boolean value");
    }

    // Validate database configuration
    if (!this.config.database) {
      throw new Error("Database configuration is required");
    }

    if (!this.config.database.path) {
      throw new Error("Database path is required");
    }

    // Validate email configuration
    if (!this.config.email) {
      throw new Error("Email configuration is required");
    }

    const requiredEmailFields = ["from", "to", "subject", "smtp"];
    for (const field of requiredEmailFields) {
      if (!this.config.email[field]) {
        throw new Error(`Email configuration missing required field: ${field}`);
      }
    }

    const requiredSmtpFields = ["host", "port", "user", "password"];
    for (const field of requiredSmtpFields) {
      if (!this.config.email.smtp[field]) {
        throw new Error(`SMTP configuration missing required field: ${field}`);
      }
    }

    // Validate cron configuration
    if (!this.config.cron) {
      throw new Error("Cron configuration is required");
    }

    // Validate services configuration
    if (!this.config.services || !Array.isArray(this.config.services)) {
      throw new Error("Services configuration must be an array");
    }

    if (this.config.services.length === 0) {
      throw new Error("At least one service must be configured");
    }

    // Validate each service
    for (const service of this.config.services) {
      if (!service.id || !service.name) {
        throw new Error("Each service must have id and name");
      }

      // Basic UUID validation
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(service.id)) {
        throw new Error(`Invalid UUID format for service: ${service.name}`);
      }
    }

    // Check for duplicate service IDs
    const serviceIds = this.config.services.map((s) => s.id);
    const uniqueIds = new Set(serviceIds);
    if (uniqueIds.size !== serviceIds.length) {
      throw new Error("Duplicate service IDs found");
    }
  }

  getServiceById(serviceId) {
    if (!this.config || !this.config.services) {
      return null;
    }
    const service = this.config.services.find(
      (service) => service.id === serviceId
    );
    return service || null;
  }

  getEmailConfig() {
    return this.config.email;
  }

  getCronConfig() {
    return this.config.cron;
  }

  getServices() {
    return this.config.services;
  }

  getServerConfig() {
    return this.config.server;
  }

  getDatabaseConfig() {
    return this.config.database;
  }
}

module.exports = ConfigLoader;
