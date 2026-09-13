# Project plan

Phased build plan for the Project Management MVP. See `AGENTS.md` for business
requirements and technical decisions, and `docs/DATABASE_SCHEMA.md` for the DB
schema. Each part lists substeps, the tests that cover it, and the success
criteria used to call it done. Status reflects the actual state of the
codebase, not just what's been committed.

Sign-off: pending — this enriched version reflects the actual state of the
codebase as of 2026-09-13 and is awaiting the user's review and approval.

## Part 1: Plan

- [x] Write this phased plan with substeps, tests, and success criteria.
- [x] Create `frontend/AGENTS.md` describing the existing frontend code
      (placeholder only, per root `AGENTS.md`).
- [x] Get user sign-off on the plan.

Success criteria: user has reviewed and approved this document before further
implementation work proceeds.

## Part 2: Scaffolding

- [x] `backend/app/main.py`: FastAPI app with `/api/hello` and `/health`.
- [x] `Dockerfile`: two-stage build (Next static export, then Python 3.12-slim
      running uvicorn).
- [x] `docker-compose.yml`: passes `OPENROUTER_API_KEY` through from `.env`.
- [x] `scripts/start.{sh,ps1,bat}` / `scripts/stop.{sh,ps1,bat}`: start/stop
      the backend locally on port 8000, for Mac/Linux/Windows.

Tests: `backend/tests/test_main.py` hits `/api/hello` and `/health` via
`TestClient`.

Success criteria: `docker compose up --build` serves a working hello-world
API; the scripts start and stop the backend without manual intervention.

## Part 3: Add in Frontend

- [x] NextJS app configured for static export (`next.config` → `frontend/out`),
      mounted at `/` by the backend via `StaticFiles` when the build exists.
- [x] Demo Kanban board UI: `KanbanBoard.tsx`, `KanbanColumn.tsx`,
      `KanbanCard.tsx`, `KanbanCardPreview.tsx`, `NewCardForm.tsx`, drag-and-drop
      via `@dnd-kit`.
- [x] Pure reducer logic (`moveCard`) extracted into `lib/kanban.ts`, unit
      tested separately from component behavior.

Tests: `frontend/src/lib/kanban.test.ts` (reducer logic), initial
`KanbanBoard.test.tsx` (renders board, drag/drop), `npm run lint`.

Success criteria: `npm run build` produces `frontend/out`; visiting `/` on the
backend serves the Kanban demo; unit tests and lint pass.

## Part 4: Fake user sign-in

- [x] Sign-in gate in `KanbanBoard.tsx`: hardcoded `user` / `password` check,
      client-side only, no session persistence across reloads.
- [x] Log out control that clears local state (including chat state, once
      Part 10 added it).
- [x] Invalid credentials show an inline error instead of granting access.

Tests: `KanbanBoard.test.tsx` covers the sign-in gate ("requires sign in
before showing the board"); `frontend/tests/kanban.spec.ts` Playwright specs
are titled "... after sign-in" and drive the real sign-in form against a live
dev server.

Success criteria: the board is not visible before signing in with the exact
demo credentials; signing out returns to the sign-in gate.

## Part 5: Database modeling

- [x] Proposed schema documented in `docs/DATABASE_SCHEMA.md`: `users(id,
      username)` and `boards(id, user_id UNIQUE, board_json)`, board stored as
      one JSON blob (`columns[]` + `cards{}` keyed by id).
- [x] User sign-off on the schema.

Success criteria: schema doc matches what Part 6 actually implements (see
below); user approved the JSON-blob-per-board approach over a normalized
schema for MVP simplicity.

## Part 6: Backend board API

- [x] `init_db()` creates `users` and `boards` tables if missing, run at
      import time and defensively inside `get_board_for_user` /
      `save_board_for_user`.
- [x] `get_board_for_user` / `save_board_for_user` lazily create the user and
      a default board on first access.
- [x] `GET /api/board?user=...` returns the user's board (creating it if
      needed).
- [x] `PUT /api/board?user=...` persists a full board replacement and returns
      it back.
- [x] Board data is scoped per user (`user_id UNIQUE` on `boards`).
- [x] `backend/tests/conftest.py` isolates each test run into a tmp SQLite
      file so tests never touch the real `project_management.db`.

Tests: `backend/tests/test_board_api.py` — default board creation, put/get
round-trip, per-user scoping.

Success criteria: a fresh clone with no `project_management.db` gets one
created automatically on first API call; `pytest` passes without touching the
real DB file.

## Part 7: Frontend + Backend integration

- [x] `frontend/src/lib/api.ts`: `fetchBoard`, `saveBoard`, `askAI` wrapping
      the three backend endpoints, all relative to `/api`.
- [x] `KanbanBoard.tsx` loads the board from the backend on sign-in
      (`useEffect` keyed on `isSignedIn`/`username`).
- [x] Board changes autosave to the backend on a 150ms debounce.
- [x] Card create/delete/edit and column rename all flow through backend
      persistence via the same debounced save.

Tests: `KanbanBoard.test.tsx` — "loads the board from the backend after sign
in", "saves changes back to the backend", "allows card titles and details to
be edited" (mocks `lib/api.ts`); `frontend/tests/kanban.spec.ts` — add card,
edit card, move card, load board, each run against a live backend.

Success criteria: reloading the page after making changes shows the
persisted state (backed by the real API, not local-only state); no
optimistic-save indicator or conflict handling is needed for the MVP (single
user at a time).

## Part 8: AI connectivity

- [x] `call_openrouter(messages, response_format=None)` posts to
      `https://openrouter.ai/api/v1/chat/completions` using model
      `openai/gpt-oss-120b`, with `OPENROUTER_API_KEY` loaded from the root
      `.env` via `python-dotenv`.
- [x] `POST /api/ai/test` sends a raw prompt and returns the model's answer,
      used as a "2+2" connectivity smoke test.
- [x] Network failures, non-200 responses, and malformed OpenRouter payloads
      all surface as `502` instead of an unhandled exception; a missing API
      key surfaces as `500`.

Tests: `backend/tests/test_ai_connectivity.py` — successful call, missing API
key.

Success criteria: `POST /api/ai/test {"prompt": "2+2"}` returns an answer
from the real model when `OPENROUTER_API_KEY` is set.

## Part 9: AI board endpoint with structured outputs

- [x] `POST /api/ai/board` sends the user's question, full board JSON, and
      conversation history to OpenRouter as a system + history + user message
      sequence.
- [x] The request uses a real OpenRouter structured-outputs constraint
      (`response_format: {"type": "json_schema", "json_schema": {"strict":
      true, ...}}`) shaped as `{reply: string, board_update: object | null}`,
      rather than only describing the shape in prompt text.
- [x] Cards are exchanged with the model as an array (`board_to_ai_shape` /
      `ai_shape_to_board`) since strict JSON Schema can't express the
      internal app's arbitrary-keyed `cards` dict; the external API contract
      (`BoardData` with `cards` as a dict) is unchanged.
- [x] A `board_update` in the reply is persisted via `save_board_for_user`
      before returning.
- [x] A response that fails to parse as JSON surfaces as a `502` rather than
      silently falling back to a plain-text reply.

Tests: `backend/tests/test_ai_connectivity.py` — applies a board update and
asserts the request used a strict `json_schema` response format; rejects a
non-JSON model response with a 502.

Success criteria: asking the AI to change the board results in a
schema-conformant response every time the provider honors
`response_format`, with a clear error surfaced (not a silent no-op) if it
doesn't.

## Part 10: AI chat sidebar

- [x] Chat sidebar ("AI Planner") in `KanbanBoard.tsx`: message history,
      loading state, error state, collapsible via a Hide/Show toggle.
- [x] Submitting a question calls `askAI` with the current board and
      conversation history, appends the assistant's reply to the chat.
- [x] If `board_update` comes back non-null, the whole board is replaced
      client-side with that value (no merge), which also triggers the Part 7
      autosave.
- [x] Chat state resets on log out.

Tests: `KanbanBoard.test.tsx` — "sends the board to the AI assistant and
applies board updates" (mocks `askAI`).

Success criteria: asking the assistant to change the board in the running
app updates the Kanban UI without a manual refresh.

## Known gaps / follow-ups

- No merge logic if the AI's `board_update` conflicts with concurrent local
  edits — acceptable for the MVP's single-user-at-a-time constraint, but
  worth flagging if multi-user support is ever added.
- `openai/gpt-oss-120b`'s actual level of support for `strict` structured
  outputs via OpenRouter is confirmed only from OpenRouter's docs (the model
  accepts a `response_format` parameter); it hasn't been exercised against a
  real OpenRouter call with a live API key in this environment. Run
  `/api/ai/board` for real once `OPENROUTER_API_KEY` is set, to confirm the
  provider actually enforces the schema rather than merely accepting the
  parameter.
