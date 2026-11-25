.PHONY: install dev dev-backend dev-frontend migrate scan seed openapi lint test check-contrast screenshots clean

PYTHON ?= uv run --directory backend python
NPM ?= npm --prefix frontend

install:
	cd backend && uv sync --all-extras
	$(NPM) ci

dev-backend:
	cd backend && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

dev-frontend:
	$(NPM) run dev

dev:
	$(MAKE) -j2 dev-backend dev-frontend

migrate:
	cd backend && uv run alembic upgrade head

seed:
	cd backend && uv run python scripts/make_demo_data.py

scan:
	cd backend && uv run python -m app.cli scan

openapi:
	cd backend && uv run python -m app.cli export-openapi --out openapi.json
	$(NPM) run generate:api

lint:
	cd backend && uv run ruff check . && uv run mypy --strict app
	$(NPM) run lint

check-contrast:
	$(NPM) run check:contrast

test:
	cd backend && uv run pytest
	$(NPM) run test

screenshots:
	$(NPM) run test:e2e

clean:
	rm -rf backend/.mypy_cache backend/.ruff_cache backend/.pytest_cache frontend/dist frontend/playwright-report frontend/test-results

