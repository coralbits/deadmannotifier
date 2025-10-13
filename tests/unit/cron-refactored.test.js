const { expect } = require("chai");
const CronService = require("../../src/services/cron");
const ConfigLoader = require("../../src/services/config");
const Database = require("../../src/db/database");
const fs = require("fs");
const yaml = require("js-yaml");

describe("Refactored CronService", () => {
  let cronService;
  let testConfigPath;
  let testDbPath;

  const validConfig = {
    server: {
      host: "0.0.0.0",
      port: 3000,
      with_cron: false,
    },
    database: {
      path: "test-refactored-cron.db",
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
    testConfigPath = "test-refactored-cron-config.yaml";
    testDbPath = "test-refactored-cron.db";

    fs.writeFileSync(testConfigPath, yaml.dump(validConfig));

    const configLoader = new ConfigLoader(testConfigPath);
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

  describe("SOLID Principles Compliance", () => {
    it("should follow Single Responsibility Principle - data gathering", async () => {
      const cronData = await cronService.gatherCronData();

      // Should return structured data with all necessary components
      expect(cronData).to.have.property("services");
      expect(cronData).to.have.property("events");
      expect(cronData).to.have.property("serviceMap");
      expect(cronData).to.have.property("configuredServices");

      // Should include all configured services
      expect(cronData.configuredServices).to.have.length(3);
      expect(cronData.services).to.have.length(3); // All services should be included
    });

    it("should follow Single Responsibility Principle - service mapping", () => {
      const configuredServices = cronService.configLoader.getServices();
      const serviceMap = cronService.createServiceMap(configuredServices);

      // Should create proper ID to name mapping
      expect(serviceMap).to.have.property(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d"
      );
      expect(serviceMap["438c41d2-f4d8-4697-aaa6-ab7bfd02b07d"]).to.equal(
        "Backup Service"
      );
      expect(serviceMap["438c41d2-f4d8-4697-aaa6-ab7bfd02b07e"]).to.equal(
        "Database Sync"
      );
      expect(serviceMap["438c41d2-f4d8-4697-aaa6-ab7bfd02b07f"]).to.equal(
        "File Monitor"
      );
    });

    it("should follow Single Responsibility Principle - state mapping", async () => {
      // Add some events to create states
      await cronService.db.insertEvent(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        "ok",
        "Backup completed successfully",
        "127.0.0.1"
      );
      await cronService.db.updateCurrentState(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        "ok"
      );

      const currentStates = await cronService.db.getCurrentStates();
      const stateMap = cronService.createStateMap(currentStates);

      // Should create proper ID to state mapping
      expect(stateMap).to.have.property("438c41d2-f4d8-4697-aaa6-ab7bfd02b07d");
      expect(stateMap["438c41d2-f4d8-4697-aaa6-ab7bfd02b07d"].state).to.equal(
        "ok"
      );
    });

    it("should follow Single Responsibility Principle - service list building", async () => {
      const configuredServices = cronService.configLoader.getServices();
      const stateMap = {};

      const { services, events } = await cronService.buildServiceList(
        configuredServices,
        stateMap
      );

      // Should include all configured services, even missing ones
      expect(services).to.have.length(3);
      expect(services.every((s) => s.state === "nak")).to.be.true; // All should be nak since no states

      // Should not have events since no services reported
      expect(events).to.have.length(0);
    });
  });

  describe("Complete Logs Handling", () => {
    it("should preserve complete logs without cropping", async () => {
      const longLogs = `Backup started at ${new Date().toISOString()}
Processing file: /data/important-file1.txt
Processing file: /data/important-file2.txt
Processing file: /data/important-file3.txt
Backup completed successfully
Total files processed: 3
Total size: 1.2GB
Duration: 5 minutes`;

      // Add event with long logs
      await cronService.db.insertEvent(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        "ok",
        longLogs,
        "127.0.0.1"
      );
      await cronService.db.updateCurrentState(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        "ok"
      );

      const cronData = await cronService.gatherCronData();

      // Should preserve complete logs
      expect(cronData.events).to.have.length(1);
      expect(cronData.events[0].logs).to.equal(longLogs);
      expect(cronData.events[0].logs).to.include("Total files processed: 3");
      expect(cronData.events[0].logs).to.include("Duration: 5 minutes");
    });

    it("should handle logs with special characters", async () => {
      const specialLogs = `Error: File not found: /path/with spaces/file.txt
Warning: Permission denied for user "admin"
Info: Process completed with exit code 0
Debug: Memory usage: 45.2MB`;

      await cronService.db.insertEvent(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        "nok",
        specialLogs,
        "127.0.0.1"
      );
      await cronService.db.updateCurrentState(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
        "nok"
      );

      const cronData = await cronService.gatherCronData();

      // Should preserve special characters
      expect(cronData.events[0].logs).to.equal(specialLogs);
      expect(cronData.events[0].logs).to.include('"admin"');
      expect(cronData.events[0].logs).to.include("spaces");
    });
  });

  describe("Config Service Iteration", () => {
    it("should iterate over all services defined in config", async () => {
      const cronData = await cronService.gatherCronData();

      // Should include all 3 services from config
      expect(cronData.services).to.have.length(3);

      const serviceIds = cronData.services.map((s) => s.service_id);
      expect(serviceIds).to.include("438c41d2-f4d8-4697-aaa6-ab7bfd02b07d");
      expect(serviceIds).to.include("438c41d2-f4d8-4697-aaa6-ab7bfd02b07e");
      expect(serviceIds).to.include("438c41d2-f4d8-4697-aaa6-ab7bfd02b07f");
    });

    it("should use service names from config file", async () => {
      const cronData = await cronService.gatherCronData();

      // Service map should use names from config
      expect(
        cronData.serviceMap["438c41d2-f4d8-4697-aaa6-ab7bfd02b07d"]
      ).to.equal("Backup Service");
      expect(
        cronData.serviceMap["438c41d2-f4d8-4697-aaa6-ab7bfd02b07e"]
      ).to.equal("Database Sync");
      expect(
        cronData.serviceMap["438c41d2-f4d8-4697-aaa6-ab7bfd02b07f"]
      ).to.equal("File Monitor");
    });

    it("should handle mixed service states correctly", async () => {
      // Add events for some services
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
      // File Monitor service has no events (missing)

      const cronData = await cronService.gatherCronData();

      // Should have all 3 services with correct states
      expect(cronData.services).to.have.length(3);

      const okService = cronData.services.find(
        (s) => s.service_id === "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d"
      );
      const nokService = cronData.services.find(
        (s) => s.service_id === "438c41d2-f4d8-4697-aaa6-ab7bfd02b07e"
      );
      const nakService = cronData.services.find(
        (s) => s.service_id === "438c41d2-f4d8-4697-aaa6-ab7bfd02b07f"
      );

      expect(okService.state).to.equal("ok");
      expect(nokService.state).to.equal("nok");
      expect(nakService.state).to.equal("nak");
    });
  });

  describe("Display Methods", () => {
    it("should display service status correctly", async () => {
      const services = [
        {
          service_id: "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
          state: "ok",
          last_updated: new Date().toISOString(),
        },
      ];
      const serviceMap = {
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d": "Backup Service",
      };

      // Capture console output
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => {
        logs.push(args.join(" "));
      };

      try {
        cronService.displayServiceStatus(services, serviceMap);
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");
      expect(output).to.include("Backup Service");
      expect(output).to.include("OK");
    });

    it("should display recent logs with proper newline handling", async () => {
      const events = [
        {
          service_id: "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d",
          state: "ok",
          timestamp: new Date().toISOString(),
          source_ip: "127.0.0.1",
          logs: "Line 1\nLine 2\nLine 3",
        },
      ];
      const serviceMap = {
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d": "Backup Service",
      };

      // Capture console output
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => {
        logs.push(args.join(" "));
      };

      try {
        cronService.displayRecentLogs(events, serviceMap);
      } finally {
        console.log = originalLog;
      }

      const output = logs.join("\n");
      expect(output).to.include("Backup Service");
      expect(output).to.include("Line 1");
      expect(output).to.include("Line 2");
      expect(output).to.include("Line 3");
    });
  });
});
