const { expect } = require("chai");
const EmailService = require("../../src/services/email");
const fs = require("fs");
const path = require("path");

describe("EmailService", () => {
  let emailService;
  const testConfig = {
    from: "test@example.com",
    to: "admin@example.com",
    subject: "Test Subject",
    smtp: {
      host: "smtp.example.com",
      port: 587,
      user: "test@example.com",
      password: "password",
    },
  };

  beforeEach(async () => {
    emailService = new EmailService(testConfig);
    await emailService.init();
  });

  describe("generateEmailContent", () => {
    it("should include all service names in email", async () => {
      const services = [
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
      ];

      const emailContent = await emailService.generateEmailContent(
        services,
        []
      );

      // Check that all service names are present
      expect(emailContent).to.include("Backup Service");
      expect(emailContent).to.include("Database Sync");
      expect(emailContent).to.include("File Monitor");
    });

    it("should highlight missing services with warning", async () => {
      const services = [
        {
          name: "Missing Service",
          state: "nak",
          last_updated: new Date().toISOString(),
        },
      ];

      const emailContent = await emailService.generateEmailContent(
        services,
        []
      );

      // Check that missing service is highlighted
      expect(emailContent).to.include("⚠️");
      expect(emailContent).to.include("nak");
      expect(emailContent).to.include("(MISSING!)");
      expect(emailContent).to.include("status-nak");
    });

    it("should set correct subject based on worst state", async () => {
      const services = [
        {
          name: "Service 1",
          state: "ok",
          last_updated: new Date().toISOString(),
        },
        {
          name: "Service 2",
          state: "nak",
          last_updated: new Date().toISOString(),
        },
      ];

      const emailContent = await emailService.generateEmailContent(
        services,
        []
      );

      // Subject should reflect worst state (NAK)
      expect(emailContent).to.include("[NAK] Test Subject");
    });

    it("should handle services with unknown names gracefully", async () => {
      const services = [
        {
          name: "Unknown Service",
          state: "ok",
          last_updated: new Date().toISOString(),
        },
      ];

      const emailContent = await emailService.generateEmailContent(
        services,
        []
      );

      // Should still include the service name
      expect(emailContent).to.include("Unknown Service");
    });

    it("should include logs with proper service names", async () => {
      const services = [
        {
          name: "Test Service",
          state: "ok",
          last_updated: new Date().toISOString(),
        },
      ];

      const logs = [
        {
          service_name: "Test Service",
          state: "ok",
          timestamp: new Date().toISOString(),
          logs: "Test log message",
        },
      ];

      const emailContent = await emailService.generateEmailContent(
        services,
        logs
      );

      // Check that logs section includes service name
      expect(emailContent).to.include("Test Service (ok)");
      expect(emailContent).to.include("Test log message");
    });

    it("should handle empty services array", async () => {
      const emailContent = await emailService.generateEmailContent([], []);

      // Should still generate valid email
      expect(emailContent).to.include("Test Subject");
      expect(emailContent).to.include("No services configured");
    });

    it("should handle services with special characters in names", async () => {
      const services = [
        {
          name: "Service & Co.",
          state: "ok",
          last_updated: new Date().toISOString(),
        },
        {
          name: "Service <script>alert('xss')</script>",
          state: "nok",
          last_updated: new Date().toISOString(),
        },
      ];

      const emailContent = await emailService.generateEmailContent(
        services,
        []
      );

      // Should include service names (HTML should be escaped by Handlebars)
      expect(emailContent).to.include("Service &amp; Co.");
      expect(emailContent).to.include(
        "Service &lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;"
      );
    });
  });

  describe("getWorstState", () => {
    it("should return nak for empty services", () => {
      const worstState = emailService.getWorstState([]);
      expect(worstState).to.equal("nak");
    });

    it("should return nak when any service is nak", () => {
      const services = [{ state: "ok" }, { state: "nak" }, { state: "nok" }];
      const worstState = emailService.getWorstState(services);
      expect(worstState).to.equal("nak");
    });

    it("should return nok when no nak but has nok", () => {
      const services = [{ state: "ok" }, { state: "nok" }, { state: "ok" }];
      const worstState = emailService.getWorstState(services);
      expect(worstState).to.equal("nok");
    });

    it("should return ok when all services are ok", () => {
      const services = [{ state: "ok" }, { state: "ok" }, { state: "ok" }];
      const worstState = emailService.getWorstState(services);
      expect(worstState).to.equal("ok");
    });
  });
});
