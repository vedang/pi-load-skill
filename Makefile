SHELL := /bin/bash
.SHELLFLAGS := -Eeuo pipefail -c
.DEFAULT_GOAL := help
BIOME_SCOPE := package.json biome.json knip.json tsconfig.json $(wildcard vitest.config.*.ts) $(wildcard src) $(wildcard __tests__) $(wildcard scripts)

.PHONY: help format check check-biome check-typescript check-knip test test-unit test-integration
help: ## Show quality gates
	@printf '%s\n' 'make format  Format with Biome' 'make check   Biome, TypeScript, Knip' 'make test    Deterministic unit and integration suites'
format: ## Format project files
	pnpm exec biome check --write $(BIOME_SCOPE)
check-biome:
	pnpm exec biome check $(BIOME_SCOPE)
check-typescript:
	pnpm exec tsc --noEmit -p tsconfig.json
check-knip:
	pnpm exec knip
check: check-biome check-typescript check-knip
test-unit:
	pnpm exec vitest run --config vitest.config.unit.ts
test-integration:
	pnpm exec vitest run --config vitest.config.integration.ts
test: test-unit
	@$(MAKE) test-integration
