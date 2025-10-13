#!/usr/bin/env node

const { Command } = require("commander");
const serveCommand = require("./cli/serve");
const listCommand = require("./cli/list");
const logsCommand = require("./cli/logs");
const cronCommand = require("./cli/cron");

const program = new Command();

program
  .name("dms")
  .description("Dead Man Notifier - Monitor service health")
  .version("1.0.0");

program
  .command("serve")
  .description("Start the Dead Man Notifier server")
  .option("-h, --host <host>", "Host to bind to")
  .option("-p, --port <port>", "Port to listen on")
  .option("-c, --config <path>", "Path to config file", "config.yaml")
  .option("--with-cron", "Enable embedded cron job")
  .action(serveCommand);

program
  .command("list")
  .description("List current service states")
  .option("-c, --config <path>", "Path to config file", "config.yaml")
  .action(listCommand);

program
  .command("logs")
  .description("Show latest events from all services")
  .option("-c, --config <path>", "Path to config file", "config.yaml")
  .option("-n, --limit <number>", "Number of events to show", "10")
  .action(logsCommand);

program
  .command("cron")
  .description("Manage cron jobs")
  .option("-c, --config <path>", "Path to config file", "config.yaml")
  .option("--init", "Initialize cron entry")
  .action(cronCommand);

program.parse();
