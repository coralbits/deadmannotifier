const { expect } = require("chai");
const Database = require("../../src/db/database");
const fs = require("fs");
const path = require("path");

describe("Log Display", () => {
  let testDbPath;
  let db;

  beforeEach(async () => {
    testDbPath = "test-logs-display.db";
    db = new Database(testDbPath);
    await db.init();
  });

  afterEach(async () => {
    await db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("should preserve newlines in log display", async () => {
    const serviceId = "test-service-id";
    const logsWithNewlines = "Line 1\nLine 2\nLine 3";

    // Insert event with logs containing newlines
    await db.insertEvent(serviceId, "ok", logsWithNewlines, "127.0.0.1");

    // Get the event back
    const events = await db.getLatestEvents(1);
    expect(events).to.have.length(1);
    expect(events[0].logs).to.equal(logsWithNewlines);

    // Test that newlines are preserved
    const logLines = events[0].logs.split("\n");
    expect(logLines).to.have.length(3);
    expect(logLines[0]).to.equal("Line 1");
    expect(logLines[1]).to.equal("Line 2");
    expect(logLines[2]).to.equal("Line 3");
  });

  it("should handle logs without newlines", async () => {
    const serviceId = "test-service-id";
    const logsWithoutNewlines = "Single line log";

    // Insert event with logs without newlines
    await db.insertEvent(serviceId, "ok", logsWithoutNewlines, "127.0.0.1");

    // Get the event back
    const events = await db.getLatestEvents(1);
    expect(events).to.have.length(1);
    expect(events[0].logs).to.equal(logsWithoutNewlines);

    // Test that single line is handled correctly
    const logLines = events[0].logs.split("\n");
    expect(logLines).to.have.length(1);
    expect(logLines[0]).to.equal("Single line log");
  });

  it("should handle empty logs", async () => {
    const serviceId = "test-service-id";

    // Insert event without logs
    await db.insertEvent(serviceId, "ok", null, "127.0.0.1");

    // Get the event back
    const events = await db.getLatestEvents(1);
    expect(events).to.have.length(1);
    expect(events[0].logs).to.be.null;
  });
});
