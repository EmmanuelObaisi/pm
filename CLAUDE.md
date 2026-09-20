# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A multi-user Project Management app: NextJS frontend + FastAPI backend over SQLite, with Kanban boards that can be shared between accounts and a per-board AI chat sidebar that reads the board and changes it through OpenRouter.

`AGENTS.md` holds the business requirements; `backend/AGENTS.md`, `frontend/AGENTS.md` and `scripts/AGENTS.md` describe each area's layout and are kept current — read those before changing code in them. `docs/DATABASE_SCHEMA.md` covers the schema and `docs/UPGRADE_PLAN.md` the MVP-to-current upgrade.

This started as an MVP (one hardcoded account, one board per user, whole board stored as a JSON blob). Those limits were **lifted deliberately** — if you find a doc or comment describing that shape, it is stale, not a constraint to preserve. What still holds:

- Runs locally in Docker; SQLite is the database, created automatically if missing.
- A fresh instance seeds a `user` / `password` admin account so sign-in works immediately (`repository.ensure_demo_user`), but real registration and password hashing are the actual auth path.
- `uv` is the Python package manager inside Docker (the repo's `.venv`/`requirements.txt` are for local dev outside Docker).
- AI calls go through OpenRouter using model `openai/gpt-oss-120b`; `OPENROUTER_API_KEY` lives in the root `.env`.
- Keep it simple: no over-engineering, no unnecessary defensive programming, no emojis anywhere.
- When debugging, find the root cause before fixing — don't guess.

## Architecture

**Backend** (`backend/app/`) is a package, not a single file. `main.py` is wiring only: it includes the routers, serves `/health` and `/api/hello`, creates the schema and demo user in a `lifespan` handler (deliberately *not* at import time), and mounts `frontend/out` at `/` when that directory exists.

- **Auth**: JWT bearer tokens (`security.py`, PyJWT, HS256) over PBKDF2-SHA256 password hashes with a per-user salt. `JWT_SECRET` defaults to a development value — set it for anything real. The first account registered on an empty instance becomes admin.
- **Schema** (`db.py`): fully normalized — `users`, `boards`, `board_members`, `board_columns`, `labels`, `cards`, `card_labels`, `checklist_items`, `comments`, `activity`, `ai_messages`. `migrate_legacy_schema()` upgrades an MVP database (`boards.board_json`) in place on first open. `DB_PATH` is overridable with the `PM_DB_PATH` env var.
- **Access control** (`deps.py`): board membership carries a role — `viewer` < `editor` < `owner` (`repository.ROLE_RANK`). The `board_access(minimum)` / `card_access(minimum)` / `column_access(minimum)` dependency factories resolve the target, check the caller's role, and return a `BoardContext`. A non-member gets 404, not 403, so board existence isn't leaked.
- **Data layer**: all SQL lives in `repository.py`. Mutating routes return the whole board via `board_detail()`, so the client never merges partial updates.
- **Routes** (`app/routers/`): `auth.py` (`/api/auth/register|login|me|password|users`, plus an admin router at `/api/admin/users`), `boards.py` (boards, members, columns, labels, stats, activity), `cards.py` (cards, moves, checklists, comments), `ai.py` (`/api/boards/{id}/ai` and its message history).

**AI** (`backend/app/ai.py`): the model does **not** return a replacement board. It returns `{"reply": str, "operations": [...]}` under a strict OpenRouter JSON-schema response format, where each operation is one of `create_card`, `update_card`, `move_card`, `delete_card`, `archive_card`, `create_column`, `rename_column`, `delete_column`, `add_comment`. Operations are validated against the board and applied one at a time; a failing one is collected into `errors` while the rest still run, and each success is written to the activity feed. Chat history persists in `ai_messages` (last 20 turns are sent as context).

**Frontend** (`frontend/src/`) is a component tree rooted at `Workspace.tsx`, not a single page:
- `lib/api.ts` is the typed client — holds the bearer token in a module variable set via `setAuthToken`, throws `ApiError` carrying the HTTP status.
- `lib/board.ts` is the pure, separately unit-tested logic: drag-id encoding, `resolveDrop`, `withCardMoved` (optimistic local move), filtering.
- `lib/session.ts` persists the session in localStorage, so a reload stays signed in; every access is wrapped because storage can be blocked.
- `components/`: `AuthScreen`, `BoardList`, `BoardView` (+ `BoardColumn`, `BoardCard`, `CardDrawer`), `ChatPanel`, `AccountPanel`, `BoardSidebar`, `ui.tsx`.
- `next.config.ts` sets `output: "export"` and rewrites `/api/*` to `http://localhost:8000` in dev — there is a real proxy, no CORS config needed.

**Docker**: two-stage build (Next static export, then `python:3.12-slim` running uvicorn on 8000). `docker-compose.yml` passes `OPENROUTER_API_KEY` and `JWT_SECRET` through and keeps the DB on a named volume at `/data`.

## Common commands

Frontend (from `frontend/`):
```
npm install
npm run dev          # Next dev server, proxies /api to port 8000
npm run build        # production build + static export to frontend/out
npm run lint
npm run test         # or test:unit — vitest run
npm run test:unit:watch
npm run test:e2e     # playwright — starts BOTH backend and frontend itself
npm run test:all
```
Single test: `npx vitest run src/lib/board.test.ts`, `npx vitest run -t "test name"`, `npx playwright test tests/workspace.spec.ts -g "test name"`.

Backend (from `backend/` — imports are `from app import ...`, so the working directory matters):
```
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
pytest
pytest tests/test_boards.py
pytest -k test_name
```

Local dev: `scripts/start.*` / `stop.*` run the backend only on port 8000; `start-dev-combined.ps1` (repo root, Windows, hardcoded paths) runs both. `docker compose up --build` serves everything on 8000.

## Testing notes

- Both suites enforce coverage gates, so new code without tests fails the run: `backend/pytest.ini` sets `--cov-fail-under=90`, and `vitest.config.ts` sets 90% statements/lines and 85% branches/functions over `src/lib` and `src/components`.
- Backend tests use `TestClient` against the app instance. `conftest.py` gives each test its own SQLite file (patching `db.DB_PATH` **and** resetting `db._initialized`), drops `PASSWORD_ROUNDS` to 1000 for speed, and provides `alice`/`bob`/`board` fixtures built on an `ApiUser` helper that registers an account and sends its bearer token. AI tests mock `httpx.post` rather than hitting OpenRouter.
- Frontend unit/integration tests (vitest + Testing Library) sit next to their source.
- Playwright (`frontend/tests/`) starts both servers itself with `PM_DB_PATH=e2e.db`, so e2e never touches the real database. It reuses already-running servers.
- `backend/project_management.db` is a real working database, not test data — don't delete or overwrite it casually.

## Environment note

Local HTTPS may be intercepted by antivirus or a corporate proxy that re-signs traffic with a root installed only in the OS certificate store (Avast Free Antivirus on the current dev machine). Python's default certifi bundle doesn't contain that root, so OpenRouter calls fail with `CERTIFICATE_VERIFY_FAILED`.

Both sides already handle this and need no per-machine setup: `config.py` calls `truststore.inject_into_ssl()` so Python verifies against the OS trust store, and `next.config.ts` sets `turbopackUseSystemTlsCerts` for `next/font`. Verification stays enabled in both — only the source of trusted roots changes. Never "fix" a TLS error here with `verify=False`.

To inspect a chain when something still fails:
```
echo | openssl s_client -connect openrouter.ai:443 -servername openrouter.ai 2>/dev/null | grep -E "^ *[0-9] s:|^ *i:"
```
