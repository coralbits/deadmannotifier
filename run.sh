#!/bin/sh

# Dead Man Notifier - Run Script
# This script sets up the configuration and runs the server

set -e  # Exit on any error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Detect if we're running in Docker or locally
if [ -d "/app" ] && [ -f "/app/config.yaml" ]; then
    # Running in Docker container
    CONFIG_DIR="/app/data"
    CONFIG_FILE="$CONFIG_DIR/config.yaml"
    EXAMPLE_CONFIG="/app/config.yaml"
    APP_DIR="/app"
else
    # Running locally
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    CONFIG_DIR="$SCRIPT_DIR/data"
    CONFIG_FILE="$CONFIG_DIR/config.yaml"
    EXAMPLE_CONFIG="$SCRIPT_DIR/config.yaml"
    APP_DIR="$SCRIPT_DIR"
fi

echo -e "${GREEN}Dead Man Notifier - Starting up...${NC}"
echo -e "${YELLOW}App directory: $APP_DIR${NC}"
echo -e "${YELLOW}Config directory: $CONFIG_DIR${NC}"

# Create data directory if it doesn't exist
if [ ! -d "$CONFIG_DIR" ]; then
    echo -e "${YELLOW}Creating data directory: $CONFIG_DIR${NC}"
    mkdir -p "$CONFIG_DIR"
fi

# Copy example config if config doesn't exist
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${YELLOW}Configuration file not found, copying from example...${NC}"
    if [ -f "$EXAMPLE_CONFIG" ]; then
        cp "$EXAMPLE_CONFIG" "$CONFIG_FILE"
        echo -e "${GREEN}Configuration copied to: $CONFIG_FILE${NC}"
    else
        echo -e "${RED}Error: Example configuration file not found at $EXAMPLE_CONFIG${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}Using existing configuration: $CONFIG_FILE${NC}"
fi

# Set proper permissions for the config file
chmod 644 "$CONFIG_FILE" || true

# Change to app directory
cd "$APP_DIR"

# Check if we should run with embedded cron
echo -e "${GREEN}Starting server...${NC}"
exec node src/index.js serve --config "$CONFIG_FILE" --watch
