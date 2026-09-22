.DEFAULT_GOAL := help
.SHELL := /bin/sh

.PHONY: help check-node doctor setup install build typecheck test test-coverage \
	lint format-check format hooks-install map-update map-check mutation-test clean check

help: ## Show the reproducible developer commands
	@echo "Crossword generator quality commands"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:[^=].*## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-19s %s\n", $$1, $$2}'
	@echo ""
	@echo "First-time setup: make setup"

check-node: ## Verify the Node/npm toolchain is available
	@command -v node >/dev/null 2>&1 || { echo "Node.js is required; use .node-version."; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo "npm is required."; exit 1; }

doctor: check-node ## Verify the pinned Node/npm versions
	@test "$$(node --version)" = "v$$(sed -e 's/[[:space:]]*#.*//' .node-version | sed '/^[[:space:]]*$$/d' | head -n 1)" || { \
		echo "Node version mismatch: expected $$(cat .node-version), got $$(node --version)"; exit 1; }
	@case "$$(npm --version)" in 11.*) ;; *) echo "npm 11 is required; got $$(npm --version)"; exit 1;; esac

hooks-install: ## Install the tracked local Git hooks
	@git config core.hooksPath .githooks
	@chmod +x .githooks/pre-commit .githooks/pre-push
	@echo "Git hooks installed from .githooks."

map-update: ## Regenerate and stage the repository map
	bash .scripts/generate-repo-map.sh
	git add docs/REPO_MAP.md

map-check: ## Verify the generated repository map is current
	bash .scripts/generate-repo-map.sh --check

setup: check-node hooks-install ## Install the locked workspace dependencies
	npm ci --ignore-scripts

install: setup ## Alias for clean-clone installation

build: check-node ## Type-check every workspace package
	npm run build

typecheck: build ## Named type-check gate

test: check-node ## Run all package unit and contract tests
	npm test

test-coverage: check-node ## Run tests with the repository coverage gate
	npm run test:coverage

lint: check-node ## Run ESLint with zero warnings
	npm run lint

format-check: check-node ## Verify Prettier formatting
	npm run format:check

format: check-node ## Format owned source and configuration files
	npm run format

mutation-test: check-node ## Run the deterministic construction mutation gate
	npm run test:mutation

check: typecheck lint format-check map-check test-coverage ## Run the local quality gate

clean: ## Remove generated reports and caches
	@find . -type d \( -name coverage -o -name reports -o -name .stryker-tmp \) -prune -exec rm -rf {} + 2>/dev/null || true
	@echo "Generated reports and caches cleaned."
