const Server = require("../server");
const fs = require("fs");
const path = require("path");

async function serveCommand(options) {
  const { port, host, configLoader, withCron, watch } = options;

  try {
    console.log(`Starting Dead Man Notifier server...`);
    console.log(`Host: ${host || "from config"}`);
    console.log(`Port: ${port || "from config"}`);
    console.log(`With Cron: ${withCron ? "enabled" : "disabled"}`);
    console.log(`Config Watch: ${watch ? "enabled" : "disabled"}`);

    const server = new Server(configLoader);

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\nReceived SIGINT, shutting down gracefully...");
      await server.close();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\nReceived SIGTERM, shutting down gracefully...");
      await server.close();
      process.exit(0);
    });

    await server.start(port ? parseInt(port) : null, host, withCron);

    // Start config file watching if enabled
    if (watch) {
      startConfigWatcher(server, configLoader);
    }
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

function startConfigWatcher(server, configLoader) {
  const configPath = configLoader.configPath;
  const configDir = path.dirname(configPath);
  const configFile = path.basename(configPath);

  console.log(`Watching config file: ${configPath}`);

  let reloadTimeout = null;

  const watcher = fs.watch(
    configDir,
    { recursive: false },
    (eventType, filename) => {
      // Only react to changes to the config file
      if (filename === configFile && eventType === "change") {
        // Debounce rapid file changes
        if (reloadTimeout) {
          clearTimeout(reloadTimeout);
        }

        reloadTimeout = setTimeout(async () => {
          try {
            console.log(`\n🔄 Config file changed, reloading...`);

            // Reload the config
            const newConfig = configLoader.load();
            console.log(`✅ Config reloaded successfully`);

            // Restart embedded cron if it was running
            if (server.cronService) {
              console.log(`🔄 Restarting embedded cron service...`);
              await server.stopEmbeddedCron();

              const serverConfig = configLoader.getServerConfig();
              if (serverConfig.with_cron) {
                await server.startEmbeddedCron();
                console.log(`✅ Embedded cron service restarted`);
              }
            }

            console.log(`✅ Server reloaded successfully`);
          } catch (error) {
            console.error(`❌ Failed to reload config:`, error.message);
            console.log(`⚠️  Server continues running with previous config`);
          }
        }, 500); // 500ms debounce
      }
    }
  );

  // Clean up watcher on process exit
  process.on("SIGINT", () => {
    watcher.close();
  });

  process.on("SIGTERM", () => {
    watcher.close();
  });
}

module.exports = serveCommand;
