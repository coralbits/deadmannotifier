const Server = require("../server");

async function serveCommand(options) {
  const { port, host, config } = options;

  try {
    console.log(`Starting Dead Man Notifier server...`);
    console.log(`Config: ${config}`);
    console.log(`Host: ${host || 'from config'}`);
    console.log(`Port: ${port || 'from config'}`);

    const server = new Server(config);

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

    await server.start(port ? parseInt(port) : null, host);
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

module.exports = serveCommand;
