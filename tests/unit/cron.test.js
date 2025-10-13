const { expect } = require("chai");
const CronService = require("../../src/services/cron");
const ConfigLoader = require("../../src/services/config");
const Database = require("../../src/db/database");
const fs = require("fs");
const path = require("path");

describe("CronService", () => {
  let cronService;
  let configLoader;
  let testConfigPath;
  let testDbPath;

  const validConfig = {
    server: {
      host: "0.0.0.0",
      port: 3000,
    },
    database: {
      path: "test-cron.db",
    },
    email: {
      from: "test@example.com",
      to: "admin@example.com",
      subject: "Test Subject",
      smtp: {
        host: "smtp.example.com",
        port: 587,
        user: "test@example.com",
        password: "password",
      },
    },
    cron: "0 0 * * *",
    services: [
      {
        id: "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        name: "Backup Service",
      },
      {
        id: "438c41d2-f4d8-4697-aaa6-ab7bfd02b07e",
        name: "Database Sync",
      },
      {
        id: "438c41d2-f4d8-4697-aaa6-ab7bfd02b07f",
        name: "File Monitor",
      },
    ],
  };

  beforeEach(async () => {
    // Create test config file
    testConfigPath = "test-cron-config.yaml";
    testDbPath = "test-cron.db";

    const yaml = require("js-yaml");
    fs.writeFileSync(testConfigPath, yaml.dump(validConfig));

    // Remove test database if it exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    configLoader = new ConfigLoader(testConfigPath);
    cronService = new CronService(configLoader);
    await cronService.init();
  });

  afterEach(async () => {
    await cronService.close();

    // Clean up test files
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe("runCronJob", () => {
    it("should include all configured services, even missing ones", async () => {
      // Add some events for only 2 out of 3 services
      await cronService.db.insertEvent(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        "ok",
        "Backup completed",
        "127.0.0.1"
      );
      await cronService.db.updateCurrentState(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        "ok"
      );

      await cronService.db.insertEvent(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07e",
        "nok",
        "Database sync failed",
        "127.0.0.1"
      );
      await cronService.db.updateCurrentState(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07e",
        "nok"
      );
      // Note: File Monitor service has no events (missing)

      // Capture console output
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => {
        logs.push(args.join(" "));
      };

      try {
        await cronService.runCronJob(true); // Test mode
      } finally {
        console.log = originalLog;
      }

      // Check that all 3 services are mentioned in the output
      const output = logs.join("\n");

      expect(output).to.include("Backup Service");
      expect(output).to.include("Database Sync");
      expect(output).to.include("File Monitor");

      // Check that missing service shows as NAK (with proper spacing)
      expect(output).to.include("File Monitor         | NAK");

      // Check that worst state is NAK (because of missing service)
      expect(output).to.include("Worst state detected: NAK");
    });

    it("should handle services with no events at all", async () => {
      // No events for any service

      // Capture console output
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => {
        logs.push(args.join(" "));
      };

      try {
        await cronService.runCronJob(true); // Test mode
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");

      // All services should be NAK (with proper spacing)
      expect(output).to.include("Backup Service       | NAK");
      expect(output).to.include("Database Sync        | NAK");
      expect(output).to.include("File Monitor         | NAK");

      // Worst state should be NAK
      expect(output).to.include("Worst state detected: NAK");
    });

    it("should properly map service names for email generation", async () => {
      // Add events for all services
      await cronService.db.insertEvent(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        "ok",
        "Backup completed",
        "127.0.0.1"
      );
      await cronService.db.updateCurrentState(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        "ok"
      );

      await cronService.db.insertEvent(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07e",
        "nok",
        "Database sync failed",
        "127.0.0.1"
      );
      await cronService.db.updateCurrentState(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07e",
        "nok"
      );
      // File Monitor still missing

      // Generate email content
      const emailContent = await cronService.emailService.generateEmailContent(
        [
          {
            name: "Backup Service",
            state: "ok",
            last_updated: new Date().toISOString(),
          },
          {
            name: "Database Sync",
            state: "nok",
            last_updated: new Date().toISOString(),
          },
          {
            name: "File Monitor",
            state: "nak",
            last_updated: new Date().toISOString(),
          },
        ],
        []
      );

      // Check that all service names are present in email
      expect(emailContent).to.include("Backup Service");
      expect(emailContent).to.include("Database Sync");
      expect(emailContent).to.include("File Monitor");

      // Check that missing service is highlighted
      expect(emailContent).to.include("⚠️");
      expect(emailContent).to.include("nak");
      expect(emailContent).to.include("(MISSING!)");

      // Check that subject includes worst state
      expect(emailContent).to.include("[NAK] Test Subject");
    });

    it("should handle unknown service IDs gracefully", async () => {
      // Add event with unknown service ID
      await cronService.db.insertEvent(
        "unknown-service-id",
        "ok",
        "Unknown service",
        "127.0.0.1"
      );

      // Capture console output
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => {
        logs.push(args.join(" "));
      };

      try {
        await cronService.runCronJob(true); // Test mode
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");

      // Should still show all configured services
      expect(output).to.include("Backup Service");
      expect(output).to.include("Database Sync");
      expect(output).to.include("File Monitor");

      // Unknown service should not appear in the main service list
      expect(output).to.not.include("Unknown Service");
    });

    it("should correctly identify worst state with mixed service states", async () => {
      // Add events with different states
      await cronService.db.insertEvent(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        "ok",
        "Backup completed",
        "127.0.0.1"
      );
      await cronService.db.updateCurrentState(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        "ok"
      );

      await cronService.db.insertEvent(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07e",
        "nok",
        "Database sync failed",
        "127.0.0.1"
      );
      await cronService.db.updateCurrentState(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07e",
        "nok"
      );
      // File Monitor missing (NAK)

      // Capture console output
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => {
        logs.push(args.join(" "));
      };

      try {
        await cronService.runCronJob(true); // Test mode
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");

      // Worst state should be NAK (nak > nok > ok)
      expect(output).to.include("Worst state detected: NAK");
    });
  });

  describe("getWorstState", () => {
    it("should return nak for empty services", () => {
      const worstState = cronService.getWorstState([]);
      expect(worstState).to.equal("nak");
    });

    it("should return nak when any service is nak", () => {
      const services = [{ state: "ok" }, { state: "nak" }, { state: "nok" }];
      const worstState = cronService.getWorstState(services);
      expect(worstState).to.equal("nak");
    });

    it("should return nok when no nak but has nok", () => {
      const services = [{ state: "ok" }, { state: "nok" }, { state: "ok" }];
      const worstState = cronService.getWorstState(services);
      expect(worstState).to.equal("nok");
    });

    it("should return ok when all services are ok", () => {
      const services = [{ state: "ok" }, { state: "ok" }, { state: "ok" }];
      const worstState = cronService.getWorstState(services);
      expect(worstState).to.equal("ok");
    });
  });
});
