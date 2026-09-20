# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A project management web app: a NextJS frontend and a FastAPI backend over
SQLite, with multi-user accounts, many Kanban boards per user, board sharing,
and an AI chat sidebar that reads and edits a board through OpenRouter. See
`AGENTS.md` for the business requirements and technical decisions,
`docs/UPGRADE_PLAN.md` for the plan that took this past its MVP shape, and
`docs/DATABASE_SCHEMA.md` for the schema.

Key constraints from `AGENTS.md` (do not violate without asking):
- Runs locally in Docker; SQLite is the database, created automatically if missing.
- Use `uv` as the Python package manager inside Docker (the repo's `.venv`/`requirements.txt` are used for local dev outside Docker).
- AI calls go through OpenRouter using model `openai/gpt-oss-120b`; `OPENROUTER_API_KEY` lives in the root `.env`.
- Keep it simple: no over-engineering, no unnecessary defensive programming, no emojis anywhere.
- When debugging, find the root cause before fixing — don't guess.

## Architecture

**Backend** (`backend/app/`) is a modular FastAPI app:
- `config.py` reads the root `.env` and holds JWT, password, and OpenRouter settings.
- `db.py` owns the SQLite schema, the `connect()` transaction helper, and `migrate_legacy_schema`, which converts an MVP database (one `boards.board_json` blob per user) into the normalized schema on first open. `DB_PATH` defaults to `backend/project_management.db` and is overridable with the `PM_DB_PATH` environment variable (the e2e run uses this) or by monkeypatching `db.DB_PATH` in tests.
- `security.py` does PBKDF2-SHA256 password hashing and JWT encode/decode.
- `repository.py` is all data access and serialization. `board_detail()` builds the whole-board payload every mutating route returns.
- `deps.py` provides `get_db`, `get_current_user`, `get_current_admin`, and the `board_access`/`card_access`/`column_access` dependency factories that enforce the owner > editor > viewer ladder. A non-member gets 404 (not 403) so board existence does not leak.
- `routers/` holds `auth.py` (plus the admin router), `boards.py` (boards, members, columns, labels, activity, stats), `cards.py` (cards, moves, checklists, comments), and `ai.py`.
- `ai.py` builds the OpenRouter request and applies the assistant's operations. The model returns `{reply, operations[]}` under a strict JSON schema; each operation is validated against the board and applied one at a time, and failures are collected into `errors` rather than aborting the batch.
- Auth is JWT bearer. The first account registered on an empty instance becomes an admin; a real server also seeds a `user` / `password` admin via the lifespan handler.

**Frontend** (`frontend/src/`):
- `lib/types.ts` mirrors the API payloads; `lib/api.ts` is the typed client (it holds the bearer token in a module variable set by `setAuthToken` and throws `ApiError` carrying the status).
- `lib/board.ts` is the pure logic: drag-id encoding, `resolveDrop` (which slot a drop maps to), `withCardMoved` (the optimistic local move), filtering, and presentation helpers. It is unit-tested in isolation.
- `lib/session.ts` persists the session in localStorage; every access is guarded because storage can be unavailable.
- `components/Workspace.tsx` is the root: it restores and revalidates the session, then switches between `BoardList`, `BoardView`, and `AccountPanel`.
- `BoardView.tsx` owns the board state. Every mutation calls the API and replaces the board wholesale with what comes back; drags apply optimistically first and reconcile with the server's board.
- `CardDrawer.tsx`, `ChatPanel.tsx`, and `BoardSidebar.tsx` (stats, members, labels, activity) are the side surfaces.

**Docker**: `Dockerfile` is a two-stage build — builds the Next static export (`npm run build` → `frontend/out`) then copies it alongside the backend into a `python:3.12-slim` image running `uvicorn app.main:app` on port 8000. `docker-compose.yml` passes `OPENROUTER_API_KEY` through from the environment/`.env`. In production the export is mounted at `/` via `StaticFiles`, which only happens if `frontend/out` exists, so a fresh clone without a frontend build simply won't serve `/`.

## Common commands

Frontend (run from `frontend/`):
```
npm install
npm run dev          # Next dev server, proxies /api to localhost:8000
npm run build        # production build + static export to frontend/out
npm run lint
npm run test         # or test:unit — vitest run
npm run test:unit:watch
npm run test:e2e     # playwright — starts the backend and the dev server itself
npm run test:all     # unit then e2e
```
Run a single vitest file/test: `npx vitest run src/lib/board.test.ts` or `npx vitest run -t "test name"`.
Run a single playwright test: `npx playwright test tests/workspace.spec.ts -g "test name"`.
Coverage thresholds are enforced in `vitest.config.ts` (90% statements/lines, 85% branches/functions).

Backend (run from `backend/`, using the project's Python — a `.venv` exists at the repo root):
```
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
pytest                          # all backend tests, with coverage
pytest tests/test_cards.py      # single file
pytest -k test_name             # single test by name
```
Backend tests must be run with `backend/` as the working directory (imports use `from app import ...`). `pytest.ini` sets the coverage gate at 90%.

Local dev convenience scripts:
- `scripts/start.ps1` / `start.sh` / `start.bat` — start the backend only, on port 8000.
- `scripts/stop.ps1` / `stop.sh` / `stop.bat` — stop it.
- `start-dev-combined.ps1` (repo root, Windows-specific, hardcoded paths) — starts backend and frontend together in background jobs on the first free ports in 8000–8099 / 3000–3099, streaming both logs into one terminal.

Docker:
```
docker compose up --build
```
Serves the full app (frontend static export + backend API) on port 8000.

## Testing notes

- `backend/tests/conftest.py` gives every test its own SQLite file (it patches `db.DB_PATH` and clears the init cache) and drops the PBKDF2 round count, which would otherwise dominate the suite's runtime. The `alice`/`bob`/`board` fixtures wrap a registered account and a token-bearing client.
- Backend tests use FastAPI's `TestClient` against the app instance — no live server — and patch `httpx.post` for the AI tests rather than calling OpenRouter. Note that plain `TestClient(app)` does not run the lifespan handler, so the demo account is only seeded in tests that enter it as a context manager.
- Frontend unit/integration tests (vitest + Testing Library) live next to their source. `src/test/factories.ts` builds board fixtures; `boardWithCards([["A","B"],["C"]])` gives columns 1..n with card ids 101, 102, ....
- `src/test/setup.ts` stands up `localStorage` and `scrollIntoView`, neither of which this jsdom build provides.
- Drag and drop is covered two ways: the pure slot arithmetic in `board.test.ts`, and `BoardView.dnd.test.tsx`, which stubs `DndContext` to call the drag handlers directly because real pointer dragging needs layout jsdom does not have. The browser path is covered by Playwright.
- Playwright (`frontend/tests/workspace.spec.ts`) starts both servers itself. Each test registers a fresh account, so runs do not collide; the backend runs against a throwaway `backend/e2e.db` via `PM_DB_PATH`.
- `backend/project_management.db` is a real SQLite file in the working tree (not test data) — avoid deleting or overwriting it casually.
