const { expect } = require("chai");
const request = require("supertest");
const Server = require("../../src/server");
const fs = require("fs");
const path = require("path");

describe("Server Integration Tests", () => {
  let server;
  let app;
  const testConfigPath = "test-config.yaml";
  const testDbPath = "test-server.db";

  const validConfig = {
    server: {
      host: "127.0.0.1",
      port: 3000,
    },
    database: {
      path: "test-server.db",
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
        name: "Test Service",
      },
    ],
  };

  before(async () => {
    // Create test config file
    const yaml = require("js-yaml");
    fs.writeFileSync(testConfigPath, yaml.dump(validConfig));

    // Remove test database if it exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    server = new Server(testConfigPath);
    await server.init();
    app = server.app;
  });

  after(async () => {
    await server.close();

    // Clean up test files
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe("GET /health", () => {
    it("should return health status", async () => {
      const response = await request(app).get("/health").expect(200);

      expect(response.body.status).to.equal("ok");
      expect(response.body.timestamp).to.be.a("string");
    });
  });

  describe("PUT /:id/ok", () => {
    it("should accept valid service ping", async () => {
      const serviceId = "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d";
      const logs = "Test logs";

      const response = await request(app)
        .put(`/${serviceId}/ok`)
        .send(logs)
        .expect(200);

      expect(response.body.success).to.be.true;
      expect(response.body.service).to.equal("Test Service");
      expect(response.body.state).to.equal("ok");
      expect(response.body.timestamp).to.be.a("string");
    });

    it("should reject invalid service ID", async () => {
      const invalidServiceId = "invalid-service-id";

      const response = await request(app)
        .put(`/${invalidServiceId}/ok`)
        .expect(404);

      expect(response.body.error).to.equal("Service not found");
      expect(response.body.serviceId).to.equal(invalidServiceId);
    });
  });

  describe("PUT /:id/nok", () => {
    it("should accept valid service ping", async () => {
      const serviceId = "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d";
      const logs = "Error logs";

      const response = await request(app)
        .put(`/${serviceId}/nok`)
        .send(logs)
        .expect(200);

      expect(response.body.success).to.be.true;
      expect(response.body.service).to.equal("Test Service");
      expect(response.body.state).to.equal("nok");
      expect(response.body.timestamp).to.be.a("string");
    });
  });

  describe("Database Integration", () => {
    it("should store events in database", async () => {
      const serviceId = "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d";

      await request(app).put(`/${serviceId}/ok`).send("Database test logs");

      const events = await server.db.getLatestEvents(1);
      expect(events).to.have.length(1);
      expect(events[0].service_id).to.equal(serviceId);
      expect(events[0].state).to.equal("ok");
      expect(events[0].logs).to.equal("Database test logs");
    });

    it("should update current state", async () => {
      const serviceId = "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d";

      await request(app).put(`/${serviceId}/nok`).send("State test logs");

      const states = await server.db.getCurrentStates();
      const serviceState = states.find((s) => s.service_id === serviceId);
      expect(serviceState.state).to.equal("nok");
    });
  });
});
