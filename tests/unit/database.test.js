const { expect } = require("chai");
const Database = require("../../src/db/database");
const fs = require("fs");
const path = require("path");

describe("Database", () => {
  let db;
  const testDbPath = "test.db";

  beforeEach(async () => {
    // Remove test database if it exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    db = new Database(testDbPath);
    await db.init();
  });

  afterEach(async () => {
    await db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe("insertEvent", () => {
    it("should insert an event successfully", async () => {
      const serviceId = "test-service-id";
      const state = "ok";
      const logs = "Test logs";
      const sourceIp = "127.0.0.1";

      const eventId = await db.insertEvent(serviceId, state, logs, sourceIp);

      expect(eventId).to.be.a("number");
      expect(eventId).to.be.greaterThan(0);
    });
  });

  describe("updateCurrentState", () => {
    it("should update current state successfully", async () => {
      const serviceId = "test-service-id";
      const state = "ok";

      const changes = await db.updateCurrentState(serviceId, state);

      expect(changes).to.equal(1);
    });

    it("should replace existing state", async () => {
      const serviceId = "test-service-id";

      await db.updateCurrentState(serviceId, "ok");
      const changes = await db.updateCurrentState(serviceId, "nok");

      expect(changes).to.equal(1);
    });
  });

  describe("getCurrentStates", () => {
    it("should return empty array when no states exist", async () => {
      const states = await db.getCurrentStates();

      expect(states).to.be.an("array");
      expect(states).to.have.length(0);
    });

    it("should return current states", async () => {
      const serviceId = "test-service-id";
      await db.updateCurrentState(serviceId, "ok");

      const states = await db.getCurrentStates();

      expect(states).to.have.length(1);
      expect(states[0].service_id).to.equal(serviceId);
      expect(states[0].state).to.equal("ok");
    });
  });

  describe("getLatestEvents", () => {
    it("should return empty array when no events exist", async () => {
      const events = await db.getLatestEvents();

      expect(events).to.be.an("array");
      expect(events).to.have.length(0);
    });

    it("should return latest events in descending order", async () => {
      const serviceId = "test-service-id";

      await db.insertEvent(serviceId, "ok", "First event");
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
      await db.insertEvent(serviceId, "nok", "Second event");

      const events = await db.getLatestEvents();

      expect(events).to.have.length(2);
      expect(events[0].state).to.equal("nok");
      expect(events[1].state).to.equal("ok");
    });
  });

  describe("markAllServicesAsNak", () => {
    it("should mark all services as nak", async () => {
      const serviceId1 = "service-1";
      const serviceId2 = "service-2";

      await db.updateCurrentState(serviceId1, "ok");
      await db.updateCurrentState(serviceId2, "nok");

      const changes = await db.markAllServicesAsNak();

      expect(changes).to.equal(2);

      const states = await db.getCurrentStates();
      states.forEach((state) => {
        expect(state.state).to.equal("nak");
      });
    });
  });
});
