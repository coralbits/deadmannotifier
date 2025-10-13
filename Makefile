# Dead Man Notifier Makefile
# Default target shows help
.DEFAULT_GOAL := help

# Variables
IMAGE_NAME := deadmannotifier
IMAGE_TAG := latest
CONTAINER_NAME := deadman-notifier
PORT := 3000
CONFIG_PATH := ./config.yaml
DATA_PATH := ./data

# Colors for output
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

##@ General

.PHONY: help
help: ## Display this help message
	@echo "$(GREEN)Dead Man Notifier - Available Commands:$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Development

.PHONY: install
install: ## Install dependencies
	@echo "$(YELLOW)Installing dependencies...$(NC)"
	npm install

.PHONY: test
test: ## Run all tests
	@echo "$(YELLOW)Running tests...$(NC)"
	npm test

.PHONY: test-unit
test-unit: ## Run unit tests only
	@echo "$(YELLOW)Running unit tests...$(NC)"
	npm run test:unit

.PHONY: test-integration
test-integration: ## Run integration tests only
	@echo "$(YELLOW)Running integration tests...$(NC)"
	npm run test:integration

.PHONY: lint
lint: ## Run linting (if configured)
	@echo "$(YELLOW)Running linter...$(NC)"
	@echo "$(RED)No linter configured yet$(NC)"

##@ Docker

.PHONY: docker-build
docker-build: ## Build Docker image
	@echo "$(YELLOW)Building Docker image $(IMAGE_NAME):$(IMAGE_TAG)...$(NC)"
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .
	@echo "$(GREEN)Docker image built successfully!$(NC)"

.PHONY: docker-run
docker-run: ## Run Docker container
	@echo "$(YELLOW)Running Docker container...$(NC)"
	docker run -d \
		--name $(CONTAINER_NAME) \
		-p $(PORT):3000 \
		-v $(PWD)/$(CONFIG_PATH):/app/config.yaml:ro \
		-v $(PWD)/$(DATA_PATH):/app/data \
		$(IMAGE_NAME):$(IMAGE_TAG)
	@echo "$(GREEN)Container started! Access at http://localhost:$(PORT)$(NC)"

.PHONY: docker-run-interactive
docker-run-interactive: ## Run Docker container in interactive mode
	@echo "$(YELLOW)Running Docker container in interactive mode...$(NC)"
	docker run -it --rm \
		--name $(CONTAINER_NAME)-interactive \
		-p $(PORT):3000 \
		-v $(PWD)/$(CONFIG_PATH):/app/config.yaml:ro \
		-v $(PWD)/$(DATA_PATH):/app/data \
		$(IMAGE_NAME):$(IMAGE_TAG)

.PHONY: docker-stop
docker-stop: ## Stop Docker container
	@echo "$(YELLOW)Stopping Docker container...$(NC)"
	docker stop $(CONTAINER_NAME) || true
	@echo "$(GREEN)Container stopped$(NC)"

.PHONY: docker-start
docker-start: ## Start Docker container
	@echo "$(YELLOW)Starting Docker container...$(NC)"
	docker start $(CONTAINER_NAME) || true
	@echo "$(GREEN)Container started$(NC)"

.PHONY: docker-remove
docker-remove: ## Remove Docker container
	@echo "$(YELLOW)Removing Docker container...$(NC)"
	docker rm $(CONTAINER_NAME) || true
	@echo "$(GREEN)Container removed$(NC)"

.PHONY: docker-logs
docker-logs: ## Show Docker container logs
	@echo "$(YELLOW)Showing container logs...$(NC)"
	docker logs -f $(CONTAINER_NAME)

.PHONY: docker-shell
docker-shell: ## Open shell in running container
	@echo "$(YELLOW)Opening shell in container...$(NC)"
	docker exec -it $(CONTAINER_NAME) /bin/sh

.PHONY: docker-clean
docker-clean: docker-stop docker-remove ## Stop and remove container
	@echo "$(GREEN)Container cleaned up$(NC)"

.PHONY: docker-clean-all
docker-clean-all: docker-clean ## Remove Docker image as well
	@echo "$(YELLOW)Removing Docker image...$(NC)"
	docker rmi $(IMAGE_NAME):$(IMAGE_TAG) || true
	@echo "$(GREEN)Docker image removed$(NC)"

.PHONY: docker-list
docker-list: ## Executes the list command to list the services
	@echo "$(YELLOW)Listing Docker images...$(NC)"
	docker exec $(CONTAINER_NAME) node src/index.js list

##@ Local Development

.PHONY: start
start: ## Start the application locally
	@echo "$(YELLOW)Starting Dead Man Notifier locally...$(NC)"
	node src/index.js serve

.PHONY: start-with-cron
start-with-cron: ## Start the application with embedded cron
	@echo "$(YELLOW)Starting Dead Man Notifier with embedded cron...$(NC)"
	node src/index.js serve --with-cron

.PHONY: cron-test
cron-test: ## Run cron job in test mode
	@echo "$(YELLOW)Running cron job in test mode...$(NC)"
	node src/index.js cron --test

.PHONY: list-services
list-services: ## List current service status
	@echo "$(YELLOW)Listing service status...$(NC)"
	node src/index.js list

.PHONY: show-logs
show-logs: ## Show recent logs
	@echo "$(YELLOW)Showing recent logs...$(NC)"
	node src/index.js logs

##@ Setup

.PHONY: setup-data-dir
setup-data-dir: ## Create data directory
	@echo "$(YELLOW)Creating data directory...$(NC)"
	mkdir -p $(DATA_PATH)
	@echo "$(GREEN)Data directory created$(NC)"

.PHONY: setup
setup: setup-data-dir install ## Initial setup
	@echo "$(GREEN)Setup complete!$(NC)"

##@ Utilities

.PHONY: clean
clean: ## Clean temporary files
	@echo "$(YELLOW)Cleaning temporary files...$(NC)"
	rm -f /tmp/deadman-test-email-*.html
	@echo "$(GREEN)Cleanup complete$(NC)"

.PHONY: status
status: ## Show application status
	@echo "$(GREEN)Dead Man Notifier Status:$(NC)"
	@echo "Image: $(IMAGE_NAME):$(IMAGE_TAG)"
	@echo "Container: $(CONTAINER_NAME)"
	@echo "Port: $(PORT)"
	@echo "Config: $(CONFIG_PATH)"
	@echo "Data: $(DATA_PATH)"
	@echo ""
	@echo "$(YELLOW)Container Status:$(NC)"
	@docker ps -a --filter name=$(CONTAINER_NAME) --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" || echo "Docker not available"
