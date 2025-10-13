#!/usr/bin/env node

const { Command } = require("commander");
const ConfigLoader = require("./services/config");
const serveCommand = require("./cli/serve");
const listCommand = require("./cli/list");
const logsCommand = require("./cli/logs");
const cronCommand = require("./cli/cron");

const program = new Command();

program
  .name("dms")
  .description("Dead Man Notifier - Monitor service health")
  .version("1.0.0");

// Helper function to create command action with config loading
function createCommandAction(commandFunction) {
  return async (options) => {
    try {
      // Load configuration
      const configLoader = new ConfigLoader(options.config);
      configLoader.load();
      
      // Call the command function with configLoader instead of config path
      await commandFunction({ ...options, configLoader });
    } catch (error) {
      console.error(`Failed to load config from ${options.config}:`, error.message);
      process.exit(1);
    }
  };
}

program
  .command("serve")
  .description("Start the Dead Man Notifier server")
  .option("-h, --host <host>", "Host to bind to")
  .option("-p, --port <port>", "Port to listen on")
  .option("-c, --config <path>", "Path to config file", "config.yaml")
  .option("--with-cron", "Enable embedded cron job")
  .action(createCommandAction(serveCommand));

program
  .command("list")
  .description("List current service states")
  .option("-c, --config <path>", "Path to config file", "config.yaml")
  .action(createCommandAction(listCommand));

program
  .command("logs")
  .description("Show latest events from all services")
  .option("-c, --config <path>", "Path to config file", "config.yaml")
  .option("-n, --limit <number>", "Number of events to show", "10")
  .action(createCommandAction(logsCommand));

program
  .command("cron")
  .description("Manage cron jobs")
  .option("-c, --config <path>", "Path to config file", "config.yaml")
  .option("--init", "Initialize cron entry")
  .option("--test", "Test mode: write email to file instead of sending")
  .action(createCommandAction(cronCommand));

program.parse();
