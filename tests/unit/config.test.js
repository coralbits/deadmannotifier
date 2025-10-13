const { expect } = require("chai");
const ConfigLoader = require("../../src/services/config");
const fs = require("fs");
const path = require("path");

describe("ConfigLoader", () => {
  const testConfigPath = "test-config.yaml";

  const validConfig = {
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

  afterEach(() => {
    // Clean up test config file
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  describe("load", () => {
    it("should load valid config successfully", () => {
      // Create fresh config file for this test
      const yaml = require("js-yaml");
      fs.writeFileSync(testConfigPath, yaml.dump(validConfig));

      const configLoader = new ConfigLoader(testConfigPath);
      const config = configLoader.load();

      expect(config).to.deep.equal(validConfig);
    });

    it("should throw error for non-existent config file", () => {
      const configLoader = new ConfigLoader("non-existent.yaml");

      expect(() => configLoader.load()).to.throw("Failed to load config");
    });
  });

  describe("validate", () => {
    it("should validate complete config", () => {
      // Create fresh config file for this test
      const yaml = require("js-yaml");
      fs.writeFileSync(testConfigPath, yaml.dump(validConfig));

      const configLoader = new ConfigLoader(testConfigPath);

      expect(() => configLoader.load()).to.not.throw();
    });

    it("should throw error for missing email config", () => {
      const invalidConfig = { ...validConfig };
      delete invalidConfig.email;

      const yaml = require("js-yaml");
      fs.writeFileSync(testConfigPath, yaml.dump(invalidConfig));

      const configLoader = new ConfigLoader(testConfigPath);

      expect(() => configLoader.load()).to.throw(
        "Email configuration is required"
      );
    });

    it("should throw error for missing services", () => {
      const invalidConfig = { ...validConfig };
      delete invalidConfig.services;

      const yaml = require("js-yaml");
      fs.writeFileSync(testConfigPath, yaml.dump(invalidConfig));

      const configLoader = new ConfigLoader(testConfigPath);

      expect(() => configLoader.load()).to.throw(
        "Services configuration must be an array"
      );
    });

    it("should throw error for invalid UUID", () => {
      const invalidConfig = { ...validConfig };
      invalidConfig.services[0].id = "invalid-uuid";

      const yaml = require("js-yaml");
      fs.writeFileSync(testConfigPath, yaml.dump(invalidConfig));

      const configLoader = new ConfigLoader(testConfigPath);

      expect(() => configLoader.load()).to.throw("Invalid UUID format");
    });
  });

  describe("getServiceById", () => {
    it("should return service by ID", () => {
      // Create fresh config file for this test with unique name
      const uniqueConfigPath = "test-config-getServiceById-1.yaml";
      const yaml = require("js-yaml");
      fs.writeFileSync(uniqueConfigPath, yaml.dump(validConfig));

      const configLoader = new ConfigLoader(uniqueConfigPath);
      configLoader.load();

      const service = configLoader.getServiceById(
        "438c41d2-f4d8-4697-aaa6-ab7bfd02b07d"
      );

      expect(service).to.deep.equal(validConfig.services[0]);

      // Clean up
      if (fs.existsSync(uniqueConfigPath)) {
        fs.unlinkSync(uniqueConfigPath);
      }
    });

    it("should return null for non-existent service", () => {
      // Create fresh config file for this test with unique name
      const uniqueConfigPath = "test-config-getServiceById-2.yaml";
      const yaml = require("js-yaml");
      fs.writeFileSync(uniqueConfigPath, yaml.dump(validConfig));

      const configLoader = new ConfigLoader(uniqueConfigPath);
      configLoader.load();

      const service = configLoader.getServiceById("non-existent-id");

      expect(service).to.be.null;

      // Clean up
      if (fs.existsSync(uniqueConfigPath)) {
        fs.unlinkSync(uniqueConfigPath);
      }
    });
  });
});
