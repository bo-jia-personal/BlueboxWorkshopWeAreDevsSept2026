.PHONY: deps up load down reset clean migrate

READY_TIMEOUT ?= 120

deps:
		@if test ! -d node_modules/@opentelemetry/sdk-node; then \
			echo "Installing Node dependencies..."; \
			npm ci; \
		fi

up: deps
		docker compose up -d
		$(MAKE) migrate READY_TIMEOUT=$(READY_TIMEOUT)
		@deadline=$$(($$(date +%s) + $(READY_TIMEOUT))); \
		while ! curl --fail --silent http://localhost:4004/health >/dev/null || \
			! curl --fail --silent http://localhost:8088/api/products >/dev/null; do \
			if test $$(date +%s) -ge $$deadline; then \
				echo "Timed out waiting for payment and shop dependencies." >&2; \
				docker compose ps; \
				docker compose logs --tail=40 postgresql postgrest payment shop >&2; \
				exit 1; \
			fi; \
			sleep 2; \
		done
		@echo "Shop is ready at http://localhost:8088"

migrate:
		@deadline=$$(($$(date +%s) + $(READY_TIMEOUT))); \
		while ! docker compose exec -T postgresql pg_isready -U shop -d shop >/dev/null 2>&1; do \
			if test $$(date +%s) -ge $$deadline; then \
				echo "Timed out waiting for PostgreSQL before migration." >&2; \
				docker compose ps; \
				exit 1; \
			fi; \
			sleep 2; \
		done
		docker compose exec -T postgresql psql -v ON_ERROR_STOP=1 -U shop -d shop -f /docker-entrypoint-initdb.d/002-flash-sale.sql

load:
	docker compose --profile loadgen up load-generator

down:
		docker compose down --remove-orphans

reset:
	docker compose down -v

clean: reset up
