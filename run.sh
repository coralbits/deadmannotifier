#!/bin/sh

# Dead Man Notifier - Run Script (Rust)
set -e

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ -d "/app" ] && [ -f "/app/config.yaml" ]; then
    CONFIG_DIR="/app/data"
    CONFIG_FILE="$CONFIG_DIR/config.yaml"
    EXAMPLE_CONFIG="/app/config.yaml"
    APP_DIR="/app"
else
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    CONFIG_DIR="$SCRIPT_DIR/data"
    CONFIG_FILE="$CONFIG_DIR/config.yaml"
    EXAMPLE_CONFIG="$SCRIPT_DIR/config.yaml"
    APP_DIR="$SCRIPT_DIR"
fi

echo "${GREEN}Dead Man Notifier - Starting up...${NC}"
echo "${YELLOW}App directory: $APP_DIR${NC}"
echo "${YELLOW}Config directory: $CONFIG_DIR${NC}"

if [ ! -d "$CONFIG_DIR" ]; then
    echo "${YELLOW}Creating data directory: $CONFIG_DIR${NC}"
    mkdir -p "$CONFIG_DIR"
fi

if [ ! -f "$CONFIG_FILE" ]; then
    echo "${YELLOW}Configuration file not found, copying from example...${NC}"
    if [ -f "$EXAMPLE_CONFIG" ]; then
        cp "$EXAMPLE_CONFIG" "$CONFIG_FILE"
        echo "${GREEN}Configuration copied to: $CONFIG_FILE${NC}"
    else
        echo "${RED}Error: Example configuration file not found at $EXAMPLE_CONFIG${NC}"
        exit 1
    fi
else
    echo "${GREEN}Using existing configuration: $CONFIG_FILE${NC}"
fi

chmod 644 "$CONFIG_FILE" || true

cd "$APP_DIR"
echo "${GREEN}Starting server...${NC}"
exec dms serve --config "$CONFIG_FILE" --watch
