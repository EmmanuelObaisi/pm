# Code review

Full-repo review of the Project Management MVP (backend, frontend, Docker,
scripts, docs) as of 2026-09-13. All test suites (backend pytest, frontend
vitest, frontend Playwright) pass, and the Docker image builds and runs
correctly — see `docs/PLAN.md` for that verification. This review looks past
"does it pass" to correctness, consistency with the project's own stated
requirements, and hygiene issues that will bite later.

Findings are ordered by severity within each section. Each one names the
exact location and the evidence for the claim — no guessed root causes.

## High priority

### 1. SQLite connections are never closed (resource leak)

`backend/app/main.py:195-198` and every caller (`init_db`, `ensure_user`,
`get_board_for_user`, `save_board_for_user`) does:

```python
with get_connection() as connection:
    ...
```

`sqlite3.Connection.__exit__` only commits or rolls back the transaction —
it does **not** close the connection. Every board read/write leaks a
connection handle. This isn't speculative: `pytest` prints
`ResourceWarning: unclosed database in <sqlite3.Connection object ...>` on
every run.

**Action**: wrap connections so they actually close, e.g.
`with contextlib.closing(get_connection()) as connection:` or an explicit
`try/finally: connection.close()`. Low risk today (single-user local app),
but it's the kind of leak that turns into "database is locked" errors under
any concurrent access.

### 2. Dockerfile doesn't use `uv`, contradicting the stated requirement

`Dockerfile:16` runs `RUN pip install --no-cache-dir -r requirements.txt`.
Both `AGENTS.md` ("Use uv as the package manager for python in the Docker
container") and `CLAUDE.md` ("Use uv as the Python package manager inside
Docker... do not violate without asking") call for `uv` specifically. The
image works today, but it's a direct, explicit deviation from a documented
constraint that's flagged as needing sign-off before violating.

**Action**: switch the backend stage to `uv pip install` (or `uv sync`), or
get explicit sign-off to keep plain `pip` and update the docs to match
reality instead.

### 3. Dev API proxy port doesn't match any documented way of running the backend

`frontend/next.config.ts:9-15` rewrites `/api/*` to
`http://localhost:8002/api/:path*` — but every documented way to start the
backend locally uses a different port:

- `scripts/start.{sh,ps1,bat}` all hardcode port `8000`.
- `start-dev-combined.ps1` picks a free port starting at `8000`.
- `CLAUDE.md`'s own "Common commands" section describes
  `python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`.

So running `npm run dev` (as `CLAUDE.md` documents) against a backend
started with any of the documented scripts means every `/api/*` call
silently fails. This isn't theoretical — I hit it directly this session and
had to manually start the backend on port 8002 to get the Playwright suite
to pass. `8002` appears nowhere else in the repo.

**Action**: either standardize the backend dev port at 8000 everywhere
(update `next.config.ts`) and document it, or make the rewrite target
configurable via an env var the scripts also set.

### 4. `frontend/AGENTS.md` was never created, and `docs/PLAN.md` claims it was

The original `docs/PLAN.md` Part 1 required creating "an `AGENTS.md` file
inside the frontend directory that describes the existing code there." That
file does not exist (`backend/AGENTS.md` and `scripts/AGENTS.md` exist as
one-line placeholders; there is no `frontend/AGENTS.md` at all). The
enriched `docs/PLAN.md` written earlier this session incorrectly checks this
off as done — that was a mistake in that edit, not a reflection of the
codebase.

**Action**: create `frontend/AGENTS.md` (even a placeholder, matching the
style of the other two) and correct the checkbox in `docs/PLAN.md`.

## Medium priority

### 5. Runtime SQLite database is committed to git

`backend/project_management.db` is tracked in git and changes (binary diff)
every time the app or its Docker image runs locally, per `CLAUDE.md`'s own
note that it's "checked into the working tree state." This causes
unreviewable binary churn in history and mixes runtime state with source.
The code already supports lazy auto-creation
(`get_board_for_user`/`save_board_for_user` create the DB and default board
on first access), so nothing depends on the committed file's contents.

**Action**: add `backend/project_management.db` to `.gitignore`, `git rm
--cached` it, and let it be created on first run as the code already
intends.

### 6. Missing `.dockerignore`

There is no `.dockerignore` anywhere in the repo. `docker-compose.yml`'s
build context is the repo root, which currently includes `frontend/node_modules`
(501 MB on disk), the root `.venv` (44 MB), `.git`, and
`backend/project_management.db`. The final image doesn't ship this bloat
(only `frontend/out` is copied into the runtime stage, and the built image
verified at 60.4 MB content), but every `docker build` pays the cost of
uploading and layering that context, and `COPY frontend .`
(`Dockerfile:5`) copies the host's `node_modules` into the intermediate
build stage on top of the one `npm install` just created there — redundant
even though not currently broken by it.

**Action**: add a `.dockerignore` excluding at least `node_modules`, `.git`,
`.venv`, `**/__pycache__`, `*.db`, `frontend/.next`, `frontend/out`,
`frontend/test-results`.

### 7. Silent failure on board load/save network errors

`frontend/src/components/KanbanBoard.tsx`: both the load effect
(`void loadBoard()`, calling `fetchBoard`) and the autosave effect
(`void saveBoard(username, board)`) have no `.catch`. If the backend is
unreachable or returns an error, `fetchBoard`/`saveBoard` reject, and the
failure is swallowed — the UI just silently keeps showing stale/local state
with no error message, so a broken save looks identical to a working one.

**Action**: surface a visible error (reusing the existing `error`/`aiError`
pattern already used elsewhere in the same component) when either call
fails.

### 8. Redundant PUT immediately after every board load

The autosave `useEffect` (`KanbanBoard.tsx`) depends on `[board, isSignedIn,
username]` and fires whenever `board` changes — including the moment
`fetchBoard` populates it right after sign-in. That triggers an immediate
`PUT` of the exact data that was just `GET`-ed, on every sign-in/page load,
for no reason.

**Action**: skip the autosave effect on the render that follows the initial
load (e.g. a `hasLoadedRef` guard), so it only fires for actual local edits.

### 9. Playwright test artifacts aren't gitignored

`frontend/.gitignore` excludes `/coverage`, `/.next/`, `/out/` but nothing
for Playwright's `test-results/` or `playwright-report/` output. This
literally caused untracked files to accumulate in this session's `git
status` after running `npm run test:e2e` (screenshots and trace zips per
test).

**Action**: add `test-results/` and `playwright-report/` to
`frontend/.gitignore`.

## Low priority / nits

### 10. Dead code: `AIRequestPayload`

`backend/app/main.py:72-73`:

```python
class AIRequestPayload(dict):
    pass
```

Defined, never referenced anywhere. Remove it.

### 11. Obsolete `version` key in `docker-compose.yml`

`docker-compose.yml:1` (`version: "3.9"`) triggers a deprecation warning on
every `docker compose` command (confirmed live this session). Compose
ignores it. Remove the line.

### 12. Variable shadowing in `call_openrouter`

`backend/app/main.py`: the local `payload` (the outgoing request body) is
reassigned to the parsed response JSON (`payload = response.json()`) a few
lines later, reusing one name for two unrelated values in the same
function. Harmless but makes the function harder to read at a glance; give
the response body its own name (e.g. `response_body`).

### 13. `NewCardForm` inputs have no associated labels

`frontend/src/components/NewCardForm.tsx`: the title and details inputs
rely on `placeholder` text only, with no `<label>` — a real accessibility
gap for screen reader users (placeholder text disappears once typing
starts and isn't reliably announced as a field label).

**Action**: add visually-hidden `<label>` elements, consistent with the
pattern already used in `KanbanCard.tsx`'s edit mode
(`className="sr-only"`).

### 14. Malformed `history` entries crash `/api/ai/board` with a bare 500

`backend/app/main.py`, the loop `for entry in history: role =
entry.get("role")` assumes every item is a dict. A client sending a
non-object item in `history` raises an unhandled `AttributeError`, which
FastAPI turns into a generic 500 instead of a clean 422/400.

**Action**: low priority given this endpoint has no untrusted external
caller yet, but worth a `isinstance(entry, dict)` guard if the API is ever
opened up.

## Not flagged as issues (verified intentional / acceptable for the MVP)

- No auth beyond the hardcoded client-side check, and no server-side
  validation that a `user` query param corresponds to a real session — this
  matches `AGENTS.md`'s explicit MVP scope (single hardcoded user, DB
  user-scoped for future growth only).
- `init_db()` running on every request is redundant work but is documented,
  intentional behavior (`CLAUDE.md`) that keeps the "auto-create the DB"
  requirement trivially true; not worth the complexity of removing for an
  MVP.
- No merge/conflict handling for concurrent edits — already called out as
  an accepted gap in `docs/PLAN.md` under "Known gaps / follow-ups", and
  reasonable given the single-user-at-a-time constraint.
- SQL queries are all parameterized (`?` placeholders) — no injection risk
  found. No `dangerouslySetInnerHTML` or similar in the frontend — no XSS
  vector found.
- `.env` is correctly gitignored at the repo root; the OpenRouter API key
  is never logged or echoed back in any response.

## Summary of actions

| # | Priority | Action |
|---|----------|--------|
| 1 | High | Close SQLite connections properly (resource leak, evidenced by `ResourceWarning`) |
| 2 | High | Use `uv` in the Dockerfile, or get sign-off to update the docs instead |
| 3 | High | Fix the `next.config.ts` dev proxy port (8002) to match the documented backend port (8000) |
| 4 | High | Create `frontend/AGENTS.md` and correct the false "done" checkbox in `docs/PLAN.md` |
| 5 | Medium | Stop committing `backend/project_management.db`; gitignore + untrack it |
| 6 | Medium | Add a `.dockerignore` |
| 7 | Medium | Surface errors from failed `fetchBoard`/`saveBoard` calls instead of failing silently |
| 8 | Medium | Skip the redundant autosave PUT right after the initial board load |
| 9 | Medium | Gitignore Playwright's `test-results/` and `playwright-report/` |
| 10 | Low | Remove dead `AIRequestPayload` class |
| 11 | Low | Remove obsolete `version` key from `docker-compose.yml` |
| 12 | Low | Rename the shadowed `payload` variable in `call_openrouter` |
| 13 | Low | Add labels to `NewCardForm` inputs for accessibility |
| 14 | Low | Guard against malformed `history` entries in `/api/ai/board` |
