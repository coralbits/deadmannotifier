# Dead Man Notifier Makefile (Rust)
.DEFAULT_GOAL := help

IMAGE_NAME := deadmannotifier
IMAGE_TAG := latest
CONTAINER_NAME := deadman-notifier
# Host port published to container 3000 (override: make docker-run PORT=3005)
PORT ?= 3000
CONFIG_PATH := ./config.yaml
DATA_PATH := ./data

# Private registry (override: make push-repository DOCKER_REGISTRY=repository.lan:5000)
DOCKER_REGISTRY ?= repository.lan
IMAGE_FQN := $(DOCKER_REGISTRY)/$(IMAGE_NAME)

GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m

##@ General

.PHONY: help
help: ## Display this help message
	@echo "$(GREEN)Dead Man Notifier - Available Commands:$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Development

.PHONY: build
build: ## Build release binary
	cargo build --release

.PHONY: test
test: ## Run all tests
	cargo test

.PHONY: fmt
fmt: ## Run rustfmt
	cargo fmt --all

.PHONY: clippy
clippy: ## Run Clippy
	cargo clippy --all-targets -- -D warnings

##@ Docker

.PHONY: docker-build
docker-build: ## Build Docker image
	@echo "$(YELLOW)Building Docker image $(IMAGE_NAME):$(IMAGE_TAG)...$(NC)"
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .
	@echo "$(GREEN)Docker image $(IMAGE_NAME):$(IMAGE_TAG) built successfully!$(NC)"

.PHONY: push-registry
push-registry: docker-build ## Tag and push image to registry.lan (DOCKER_REGISTRY=…)
	@echo "$(YELLOW)Tagging $(IMAGE_NAME):$(IMAGE_TAG) -> $(IMAGE_FQN):$(IMAGE_TAG)$(NC)"
	docker tag $(IMAGE_NAME):$(IMAGE_TAG) $(IMAGE_FQN):$(IMAGE_TAG)
	@echo "$(YELLOW)Pushing $(IMAGE_FQN):$(IMAGE_TAG) (docker login $(DOCKER_REGISTRY) if needed)...$(NC)"
	docker push $(IMAGE_FQN):$(IMAGE_TAG)
	@echo "$(GREEN)Pushed $(IMAGE_FQN):$(IMAGE_TAG)$(NC)"

.PHONY: docker-run
docker-run: ## Run Docker container
	@echo "$(YELLOW)Running Docker container...$(NC)"
	@docker rm -f $(CONTAINER_NAME) 2>/dev/null || true
	docker run -d \
		--name $(CONTAINER_NAME) \
		-p $(PORT):3000 \
		-v $(PWD)/$(CONFIG_PATH):/app/config.yaml:ro \
		-v $(PWD)/$(DATA_PATH):/app/data \
		$(IMAGE_NAME):$(IMAGE_TAG)
	@echo "$(GREEN)Container started! Access at http://localhost:$(PORT)$(NC)"

.PHONY: docker-run-interactive
docker-run-interactive: ## Run Docker container in interactive mode
	@docker rm -f $(CONTAINER_NAME)-interactive 2>/dev/null || true
	docker run -it --rm \
		--name $(CONTAINER_NAME)-interactive \
		-p $(PORT):3000 \
		-v $(PWD)/$(CONFIG_PATH):/app/config.yaml:ro \
		-v $(PWD)/$(DATA_PATH):/app/data \
		$(IMAGE_NAME):$(IMAGE_TAG)

.PHONY: docker-stop
docker-stop: ## Stop Docker container
	docker stop $(CONTAINER_NAME) || true

.PHONY: docker-start
docker-start: ## Start Docker container
	docker start $(CONTAINER_NAME) || true

.PHONY: docker-remove
docker-remove: ## Remove Docker container
	docker rm $(CONTAINER_NAME) || true

.PHONY: docker-logs
docker-logs: ## Show Docker container logs
	docker logs -f $(CONTAINER_NAME)

.PHONY: docker-shell
docker-shell: ## Open shell in running container
	docker exec -it $(CONTAINER_NAME) /bin/sh

.PHONY: docker-clean
docker-clean: docker-stop docker-remove ## Stop and remove container

.PHONY: docker-clean-all
docker-clean-all: docker-clean ## Remove Docker image as well
	docker rmi $(IMAGE_NAME):$(IMAGE_TAG) || true

.PHONY: docker-list
docker-list: ## Run `dms list` inside the container
	docker exec $(CONTAINER_NAME) dms list --config /app/data/config.yaml

##@ Local

.PHONY: start
start: ## Start server locally (debug)
	cargo run -- serve

.PHONY: start-with-cron
start-with-cron: ## Start with embedded cron enabled
	cargo run -- serve --with-cron

.PHONY: cron-test
cron-test: ## Cron test mode (writes HTML to TMPDIR)
	cargo run -- cron --test

.PHONY: list-services
list-services: ## List service status
	cargo run -- list

.PHONY: show-logs
show-logs: ## Show latest logs per service
	cargo run -- logs

##@ Setup

.PHONY: setup-data-dir
setup-data-dir: ## Create data directory only
	mkdir -p $(DATA_PATH)

.PHONY: setup
setup: setup-data-dir ## Create data directory (install Rust toolchain separately)
	@echo "$(GREEN)Data directory ready.$(NC)"

.PHONY: clean
clean: ## Remove cargo build artifacts and cron test email previews
	rm -f /tmp/deadman-test-email-*.html
	cargo clean

.PHONY: status
status: ## Show image/container names and docker ps for this container
	@echo "$(GREEN)Dead Man Notifier$(NC)"
	@echo "Image: $(IMAGE_NAME):$(IMAGE_TAG)"
	@echo "Registry: $(IMAGE_FQN):$(IMAGE_TAG)"
	@echo "Container: $(CONTAINER_NAME)"
	@docker ps -a --filter name=$(CONTAINER_NAME) --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true
