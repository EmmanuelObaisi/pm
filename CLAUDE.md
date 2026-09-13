# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A Project Management MVP: a single-user-at-a-time Kanban board (NextJS frontend + FastAPI backend) with an AI chat sidebar that can read and modify the board via OpenRouter. See `AGENTS.md` for the full business requirements and technical decisions, and `docs/PLAN.md` / `docs/DATABASE_SCHEMA.md` for the phased build plan and DB schema. Sub-directory `AGENTS.md` files (`backend/AGENTS.md`, `scripts/AGENTS.md`) are currently placeholders.

Key constraints from `AGENTS.md` (do not violate without asking):
- Sign-in is hardcoded to `user` / `password` for the MVP, but the DB is user-scoped for future growth.
- Only one Kanban board per signed-in user.
- Runs locally in Docker; SQLite is the database, created automatically if missing.
- Use `uv` as the Python package manager inside Docker (the repo's `.venv`/`requirements.txt` are used for local dev outside Docker).
- AI calls go through OpenRouter using model `openai/gpt-oss-120b`; `OPENROUTER_API_KEY` lives in the root `.env`.
- Keep it simple: no over-engineering, no unnecessary defensive programming, no emojis anywhere.
- When debugging, find the root cause before fixing — don't guess.

## Architecture

**Backend** (`backend/app/main.py`) is a single-file FastAPI app:
- SQLite DB at `backend/project_management.db` (path resolved relative to the module, overridable in tests via `monkeypatch.setattr(main, "DB_PATH", ...)`, see `backend/tests/conftest.py`).
- Two tables: `users` (username) and `boards` (one row per `user_id`, storing the whole board as a `board_json` TEXT blob). There is no board/card normalization — the entire Kanban state round-trips as JSON.
- `get_board_for_user` / `save_board_for_user` lazily create the user and a default board on first access (`init_db()` also runs at import time and in each of these calls, so tables always exist).
- Routes: `GET/PUT /api/board?user=...` (whole-board read/write), `POST /api/ai/test` (raw prompt passthrough, used for connectivity smoke tests), `POST /api/ai/board` (the real AI endpoint — sends the user's question + full board JSON + conversation history to OpenRouter, expects a JSON reply shaped like `{"reply": str, "board_update": BoardData | null}`, and persists `board_update` if present), `GET /health`, `GET /api/hello`.
- In production the built Next static export (`frontend/out/`) is mounted at `/` via `StaticFiles` — this only happens if that directory exists, so a fresh clone without a frontend build simply won't serve `/`.
- There is no `/api/login` route — sign-in is entirely client-side (see below), and the backend trusts whatever `user` query param/body field it's given (username is arbitrary and just gets created on first use).

**Frontend** (`frontend/src/`) is a NextJS app, currently a single page:
- `KanbanBoard.tsx` is the whole app: sign-in gate (hardcoded `user`/`password` check, client-side only, no session persistence across reloads), the Kanban grid using `@dnd-kit`, and the AI chat sidebar, all as local component state.
- `lib/kanban.ts` holds the `BoardData`/`Column`/`Card` types and the pure `moveCard` drag-and-drop reducer logic (columns is `Column[]`, cards is a `Record<id, Card>`, columns reference cards by id) — this file is unit-tested in isolation (`kanban.test.ts`) separately from the component tests.
- `lib/api.ts` wraps the three backend calls (`fetchBoard`, `saveBoard`, `askAI`) — all requests are relative to `/api`, so in dev the Next dev server needs the backend reachable at the same origin/proxy or CORS configured (check current dev setup before assuming a proxy exists).
- Board changes autosave to the backend on a 150ms debounce (`useEffect` in `KanbanBoard.tsx`) keyed on `username`; there's no optimistic-save indicator or conflict handling.
- If the AI's `board_update` comes back, the whole board is replaced client-side with that value (no merge).

**Docker**: `Dockerfile` is a two-stage build — builds the Next static export (`npm run build` → `frontend/out`) then copies it alongside the backend into a `python:3.12-slim` image running `uvicorn app.main:app` on port 8000. `docker-compose.yml` passes `OPENROUTER_API_KEY` through from the environment/`.env`.

## Common commands

Frontend (run from `frontend/`):
```
npm install
npm run dev          # Next dev server
npm run build        # production build + static export to frontend/out (required before Docker build serves "/")
npm run lint
npm run test         # or test:unit — vitest run (component + lib unit/integration tests)
npm run test:unit:watch
npm run test:e2e     # playwright — auto-starts `next dev` on 127.0.0.1:3000 if not already running
npm run test:all     # unit then e2e
```
Run a single vitest file/test: `npx vitest run src/lib/kanban.test.ts` or `npx vitest run -t "test name"`.
Run a single playwright test: `npx playwright test tests/kanban.spec.ts -g "test name"`.

Backend (run from `backend/`, using the project's Python — a `.venv` exists at the repo root):
```
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
pytest                          # all backend tests
pytest tests/test_board_api.py  # single file
pytest -k test_name             # single test by name
```
Backend tests must be run with `backend/` as the working directory (imports use `from app import main`); `tests/conftest.py` auto-isolates each test's SQLite DB into a tmp path.

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

- Frontend unit/integration tests (vitest + Testing Library) live next to their source (`*.test.ts`/`*.test.tsx`); Playwright e2e specs live in `frontend/tests/` and drive a real browser against a running dev server, including the sign-in flow (see `frontend/tests/kanban.spec.ts` — tests are titled "... after sign-in").
- Backend tests use FastAPI's `TestClient` directly against the app instance — no live server needed — and mock `httpx.post` for AI-endpoint tests rather than hitting OpenRouter.
- `backend/project_management.db` is a real SQLite file checked into the working tree state (not test data) — avoid deleting/overwriting it casually; tests never touch it directly because of the `conftest.py` DB_PATH override.
