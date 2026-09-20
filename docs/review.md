# Code review

Review date: 20 September 2026. Scope: the full working tree (backend, frontend,
tests, Docker packaging, scripts, docs), not just the latest commit.

## Method

Every finding below names a location and says how it was established. Findings
marked **reproduced** were exercised locally against disposable copies of the
app; findings marked **static** identify a code path that was read but not run
end to end. No application code was changed, and no real board data, container,
or OpenRouter credit was consumed. Temporary probe files were deleted afterwards.

Suites run as a baseline: backend `pytest` (10 passed), frontend `vitest`
(8 passed across 2 files), `npm run lint` (clean), `npx tsc --noEmit` (clean).

## Assessment

The architecture is small and legible, and the happy path works. The problems
are concentrated in two places: **nothing validates a board before it is
persisted**, and **there is no lifecycle discipline around loading, saving, and
AI replies**. The result is that the app can silently destroy the user's board
in normal single-user operation - no concurrency, no second tab, no second user
required. Three separate paths to data loss were reproduced.

The MVP's deliberate simplifications (client-side demo sign-in, one board per
user, SQLite, whole-board replacement instead of merging) are accepted as scope
and are not counted as defects. Losing saved work inside a single tab, and
serving unauthenticated write access beyond the local machine, are separate
matters and are counted.

Priorities: **P1** means fix before trusting the app with a board you care
about. **P2** means fix in the next reliability pass. **P3** is maintenance and
hygiene.

This review overlaps with the findings recorded in `docs/code_review.md`; where
it does, treat this document as independent re-confirmation that those items are
still open in the working tree, with fresh evidence.

## P1 findings

### 1. Autosave overwrites the saved board before the initial load finishes

**Location:** `frontend/src/components/KanbanBoard.tsx:52-98`.

Signing in starts two effects at once: the GET in the load effect, and the
150 ms debounced autosave. The autosave has no idea a load is in flight -
`skipNextSaveRef` is only set when the GET resolves. If the backend takes more
than 150 ms to answer, the client PUTs its in-memory board, which at that moment
is still the bundled demo data from `lib/kanban.ts`, straight over the user's
saved board. Nothing corrects it afterwards, and the UI then renders the loaded
board, so the user sees their work while the database no longer holds it.

The same effect makes a failed load dangerous: the `catch` shows "Showing local
data instead" but leaves autosave armed, so the fallback demo board is written
to the server on the next tick.

**Evidence (reproduced):** with `fetchBoard` held on a deferred promise, sign-in
produced exactly one `saveBoard` call before the GET resolved, carrying the demo
card "Align roadmap themes". Resolving the GET afterwards with distinct saved
content produced no corrective save.

**Fix:** gate both editing and autosave on a successful initial load. Treat a
failed load as an explicit error/retry state rather than as a loaded board. Add
tests for a delayed GET and a rejected GET that assert no PUT is issued.

### 2. Invalid boards are accepted, persisted, and crash the UI

**Locations:** `backend/app/main.py:145-149,294-296,344-349`;
`frontend/src/components/KanbanBoard.tsx:169-171,361,392`;
`frontend/src/components/KanbanColumn.tsx:54-61`.

`PUT /api/board` is typed as `dict[str, Any]`, so it accepts any JSON object.
AI output is parsed but never checked against the board's structural contract.
The provider-side JSON schema does not guarantee unique card ids, that `cardIds`
reference cards that exist, or that the fixed columns survive.

Three concrete failures, all confirmed:

- `PUT /api/board` with `{}` returns 200 and is stored. A later GET returns `{}`,
  and the frontend immediately dereferences `board.columns.map`.
- A board whose column lists `cardIds: ["ghost"]` with no matching card is
  accepted and stored. Rendering it dereferences `undefined.id`.
- `ai_shape_to_board` (`main.py:148`) builds the cards dict with a comprehension,
  so two cards sharing an id silently collapse to the last one.

There is also a specific, easily hit case worth calling out on its own. When the
model returns `board_update: {}`, the backend's truthiness check at `main.py:345`
treats it as "no update" and skips the conversion and the save - but then returns
that same `{}` in the response body. In JavaScript `{}` is truthy, so
`KanbanBoard.tsx:169` accepts it and calls `setBoard({})`. The board render
crashes, and the autosave effect then PUTs `{}` to the server, converting a
provider hiccup into a wiped board. The null / empty-object distinction is not
shared between the two sides of the API.

**Evidence (reproduced):**

- Backend, against a disposable database: `PUT {}` returned `200 {}` and the
  following GET returned `{}`; dangling `cardIds` returned 200; a mocked AI reply
  with duplicate id `d1` persisted only the second card; a mocked AI reply of
  `board_update: {}` responded `200 {"reply":"ok","board_update":{}}`.
- Frontend: loading a board with a dangling `cardId` raised
  `TypeError: Cannot read properties of undefined (reading 'id')` at
  `KanbanColumn.tsx:56`; an `askAI` reply of `board_update: {}` raised
  `TypeError: Cannot read properties of undefined (reading 'map')` at
  `KanbanBoard.tsx:361`.

**Fix:** one shared board validator applied at both persistence boundaries.
Check required fields, unique ids, agreement between the `cards` keys and each
card's `id`, that every `cardId` resolves, and that the fixed columns are still
present (renaming allowed). Reject invalid client input with 422 and invalid
provider output with 502, leaving the stored board untouched. Make the empty
object and null cases converge on a single "no update" representation before it
reaches the client. Test with dangling references, duplicate ids, and removed
columns, not only with empty-board fixtures.

### 3. An AI reply overwrites edits made while the request was in flight

**Locations:** `frontend/src/components/KanbanBoard.tsx:128-171`;
`backend/app/main.py:320-349`.

`askAI` is sent a snapshot of the board, the board stays fully editable while the
request runs, and the reply replaces the whole board. Any card added or edited
during that window is discarded. This is not a multi-user problem: it happens in
one tab, to one user, and the backend has already written the snapshot-derived
board to the database by the time the client sees it, so a client-side rejection
would not be enough to undo it.

**Evidence (reproduced):** with `askAI` held on a deferred promise, a column
renamed to "EDITED WHILE AI RAN" during the request reverted to "Backlog" the
moment the reply resolved.

**Fix:** for this MVP, flush pending saves before sending the request and lock
board mutations while the AI call is outstanding, or carry a revision number and
reject a stale update server-side before persisting it. `docs/PLAN.md` already
accepts replacement-over-merge; that decision does not cover this same-tab
interleaving, and fixing it does not require a merge engine.

### 4. Container recreation loses the database

**Locations:** `docker-compose.yml:1-11`; `Dockerfile:20-26`;
`backend/app/main.py:14`.

The SQLite file resolves to `/app/backend/project_management.db` inside the
container and Compose declares no volume. Stop/start of the same container keeps
the data; `docker compose down` then `up`, or any rebuild that recreates the
container, does not. `.dockerignore:5` excludes `*.db`, so the image always ships
without one and a recreated container starts from the default board.

**Evidence (static):** full inspection of the Compose file, the Dockerfile, and
the database path. No container was removed during this review.

**Fix:** put the database in its own directory, for example `/data`, point
`DB_PATH` at it, and mount a named volume there. Do not mount over the
application directory. Document the data location and how to back it up, then
verify a distinctive card survives `down` and `up`.

### 5. Unauthenticated read/write API published on every interface

**Locations:** `docker-compose.yml:6-7`; `scripts/start.sh:7`;
`scripts/start.ps1:6`; `scripts/start.bat:7`; `start-dev-combined.ps1:51`;
`backend/app/main.py:289-303`.

The sign-in gate exists only in React. Every backend route takes the username
from the caller, creates it on demand, and trusts it. Compose publishes
`8000:8000` and all four native launchers bind uvicorn to `0.0.0.0`. Where the
host network and firewall allow it, any other machine can read or replace any
user's board.

`POST /api/ai/test` deserves separate mention: it forwards an arbitrary caller
prompt to OpenRouter on the server's API key with no authentication and no rate
limit. Exposed, it is an open proxy billed to the key in `.env`.

**Evidence (static):** configuration and route inspection. External reachability
was not tested, so the impact is conditional on the host network.

**Fix:** publish `127.0.0.1:8000:8000` and bind the native launchers to
`127.0.0.1`; keep `0.0.0.0` inside the container, where it is required. Consider
removing `/api/ai/test` now that it has served its purpose as a smoke test, or
gating it. Real authentication is a prerequisite for any deliberate shared
deployment, not for this loopback demo.

### 6. AI calls block the event loop

**Locations:** `backend/app/main.py:152-189,299-303,315-338`.

Both AI handlers are `async def` but call synchronous `httpx.post` with a 30
second timeout, so the call runs on the event loop thread. While a provider call
is in flight, the single uvicorn worker cannot serve anything else - not
autosave, not `/health`. The SQLite calls are synchronous on the same loop too,
though they are normally short enough not to matter.

**Evidence (reproduced):** with the provider call replaced by a 250 ms blocking
delay, a coroutine scheduled to complete at +10 ms actually completed at
+251 ms. No real OpenRouter request was made.

**Fix:** the smallest correct change is to declare the fully synchronous handlers
as plain `def`, which makes FastAPI run them in its worker threadpool. The
alternative is an awaited `httpx.AsyncClient`, which then needs the database
calls handled separately. Add a test that `/health` stays responsive during a
delayed AI call.

## P2 findings

### 7. Malformed provider responses return 500, not the documented 502

**Locations:** `backend/app/main.py:185-189,338-349`.

`response.json()` at line 185 sits outside the `try` that guards the provider
call, the message content is never checked for being a string, and the parsed
model JSON is assumed to be an object. Only a `JSONDecodeError` on well-formed
text is mapped to 502. `docs/PLAN.md` claims malformed payloads surface as 502;
they do not.

**Evidence (reproduced), all with a mocked provider:**

| Provider behavior | Status returned | Expected |
| --- | --- | --- |
| HTTP 200 with a non-JSON body | 500 | 502 |
| `message.content` is null | 500 | 502 |
| model returns a JSON array | 500 (AttributeError on `.get`) | 502 |
| model returns JSON null | 500 | 502 |
| model returns `{"board_update": {}}` | 200, passed to the client | 502, or a normalized no-op |

**Fix:** validate the provider envelope and the decoded content inside the
guarded region and map every invalid upstream shape to 502. Share this with the
validator from finding 2, and make sure an invalid response can never reach
`save_board_for_user`.

### 8. Autosave is not flushed on logout and saves are not ordered

**Location:** `frontend/src/components/KanbanBoard.tsx:81-98,112-126`.

The debounce cleanup clears the timer, so an edit made within 150 ms of logging
out is silently dropped. Closing or reloading the tab has the same effect.
Separately, clearing a timeout cannot cancel a request already in flight: two
overlapping saves can land out of order, and the later `.then` can clear an error
belonging to the newer save. A failed save is only retried when the user happens
to edit something else.

**Evidence:** the logout drop was reproduced - an edit followed immediately by
"Log out" produced zero `saveBoard` calls, even after waiting well past the
debounce. Reordering and retry behavior are from source inspection, not observed
over a real network.

**Fix:** track explicit loaded/dirty/saving state, serialize saves while
coalescing pending edits, and await the outstanding save before completing
logout. Warn on unload when work is unsaved. Offer an explicit retry after a
failed save.

### 9. Pending AI requests survive logout

**Location:** `frontend/src/components/KanbanBoard.tsx:112-126,155-184`.

Logout resets the chat transcript but does not invalidate an in-flight request or
reset `isAiLoading`. A late reply can append an assistant message to the fresh
transcript, raise an error banner, or replace the board after the user has logged
out or signed back in. The board-loading effect has an `ignore` guard for exactly
this; the AI path has none.

**Evidence (static):** tracing of `handleLogout` against the async completion
handlers.

**Fix:** use a session generation counter (or an `AbortController`) and drop
completions from a previous session, resetting `isAiLoading` and `aiError` on
logout. Note that aborting in the browser does not undo the server-side write, so
decide deliberately whether logout should wait.

### 10. Backend tests touch the real database at import time

**Locations:** `backend/app/main.py:361`; `backend/tests/conftest.py:6-8`.

`init_db()` runs at module import, which happens during test collection, before
the autouse fixture replaces `DB_PATH`. Per-test requests are isolated correctly
afterwards, but the claim in `docs/PLAN.md` and `CLAUDE.md` that tests never
touch `backend/project_management.db` is not accurate.

**Evidence (reproduced):** importing `app.main` from a clean copy of the package
created `project_management.db` next to it. On this machine the existing file was
not modified, because `CREATE TABLE IF NOT EXISTS` against an already initialized
database writes nothing - the file's size and timestamp were identical before and
after a full `pytest` run. On a fresh clone the file is created by the test run.

**Fix:** move initialization into a FastAPI lifespan/startup hook or an app
factory, so it runs after test settings are applied, and drop the defensive
`init_db()` calls inside `get_board_for_user` / `save_board_for_user`.

### 11. E2E tests run against whatever happens to be listening

**Locations:** `frontend/playwright.config.ts:13-18`;
`frontend/tests/kanban.spec.ts:3-63`.

Playwright starts only the Next dev server and reuses an existing one
(`reuseExistingServer: true`). It never provisions a backend or resets board
state. With a backend running, the specs mutate the demo user's real board; the
edit spec asserts the original `card-1` title, so a previous run's persisted
changes can fail the next one. With no backend, `fetchBoard` fails, the component
falls back to the bundled demo board, and the specs still pass - proving nothing
about integration.

**Evidence (static):** configuration and assertion inspection. The suite was not
executed as part of this review.

**Fix:** give E2E runs a disposable backend and database with a deterministic
seed. Assert that the load succeeded, wait for persistence, reload, and check the
exact saved values. Do not use the developer's running app as a fixture.

### 12. `scripts/stop.ps1` fails before it stops anything

**Location:** `scripts/stop.ps1:9-12`.

PowerShell variable names are case-insensitive, so `$pid` is the built-in
read-only `$PID`. The assignment throws on the first connection found, and with
`$ErrorActionPreference = "Stop"` the script exits before reaching
`Stop-Process`. The stop script has therefore never worked on Windows when a
server was actually running.

**Evidence (reproduced):** the assignment alone returns
`Cannot overwrite variable PID because it is read-only or constant.` No process
was stopped.

**Fix:** rename to `$processId`, and address finding 13 at the same time.

### 13. Stop scripts kill by port, not by ownership

**Locations:** `scripts/stop.ps1:3-12`; `scripts/stop.sh:4-7`;
`scripts/stop.bat:4-6`.

All three terminate whatever holds port 8000 without checking it is this project.
Anything else on that port is killed. The Unix `lsof -ti :8000` form can also
match a client connected to the port rather than the listener. The PowerShell
variant currently fails earlier, so fixing finding 12 in isolation would expose
this behavior.

**Evidence (static):** inspection only; no destructive stop was run.

**Fix:** record the PID written by the start script and verify it before killing,
or drive the lifecycle through Compose for the Docker workflow.

### 14. The combined dev launcher can point the frontend at the wrong backend

**Locations:** `start-dev-combined.ps1:19-24,48-59`; `frontend/next.config.ts:8-15`.

The launcher picks the first free port in 8000-8099 for the backend, but the Next
rewrite destination is hardcoded to `http://localhost:8000`. If 8000 is occupied,
the backend starts on 8001 and the frontend's `/api` calls go to whatever owns
8000 instead. The script also hardcodes one machine's repository path (line 19)
and Python installation (line 22), so it does not work on another checkout.

**Evidence (static):** comparison of the port selection, the job arguments, and
the rewrite destination.

**Fix:** either fail loudly when 8000 is taken, or pass the chosen backend origin
into the Next config through an environment variable. Derive paths from
`$PSScriptRoot` and use the repo's virtual environment.

### 15. Cards cannot be moved without a pointer

**Locations:** `frontend/src/components/KanbanBoard.tsx:44-48`;
`frontend/src/components/KanbanCard.tsx:157-166`.

Only `PointerSensor` is registered. The "Move" control is a focusable button with
a good `aria-label`, so keyboard users can reach it and get no behavior from it -
arguably worse than an obviously unavailable control.

**Evidence (static):** sensor and control inspection; no assistive technology
session was run.

**Fix:** register `KeyboardSensor` with `sortableKeyboardCoordinates`, or add a
"move to column" menu. Test starting, completing, and cancelling a move from the
keyboard.

## P3 follow-ups

- **The production build depends on fetching Google Fonts.**
  `frontend/src/app/layout.tsx:2-13` uses `next/font/google`, which downloads
  Manrope and Space Grotesk during `npm run build`. On this machine the build
  currently fails with "Failed to fetch `Manrope` from Google Fonts" and a
  Turbopack TLS hint, while `curl` to `fonts.googleapis.com` succeeds - the
  proximate cause is Turbopack's bundled certificate store versus this host's TLS
  interception, not repo code. It is still a real fragility, because the Docker
  image build runs the same step: any build host without clean egress to Google
  Fonts breaks `docker compose up --build`. Either self-host the fonts with
  `next/font/local`, or document the
  `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` workaround. The existing
  `frontend/out` from an earlier successful build is intact.
- **The default board is defined twice.** `backend/app/main.py:18-68` and
  `frontend/src/lib/kanban.ts:18-72` hold the same demo board. They agree today;
  nothing keeps them in step, and the frontend copy is what gets written over the
  user's data in finding 1.
- **The chat greeting is a magic string in three places.** `KanbanBoard.tsx:36`,
  `:121` and `:143`. The third is a filter that strips the greeting out of the
  history sent to the model by comparing exact text; editing the greeting in one
  place silently starts sending it to the model as conversation history.
- **Dead and redundant code.** `save_board_for_user` (`main.py:268`) does
  `json.loads(json.dumps(board))` on a payload FastAPI already decoded, then
  re-serializes it. `KanbanBoard.tsx:50` memoizes `board.cards` on
  `[board.cards]`, which cannot change independently of its own identity.
- **`ensure_user` has a check-then-insert race** (`main.py:221-236`). Two
  concurrent first-touch requests, which autosave plus an AI call can produce,
  would hit the UNIQUE constraint and surface as a 500. `INSERT ... ON CONFLICT
  DO NOTHING` followed by a select removes it.
- **Shell scripts are not executable.** Git records `scripts/start.sh` and
  `scripts/stop.sh` as `100644`, so `./scripts/start.sh` fails on a fresh Unix
  checkout. Commit the executable bit or document `bash scripts/start.sh`.
- **Image hygiene.** `Dockerfile:4` uses `npm install` despite a committed
  lockfile; `npm ci` would fail loudly on a mismatch instead of silently
  re-resolving. `backend/requirements.txt:3` ships `pytest` into the runtime
  image. `.dockerignore` excludes `*.db` but not `.env`; the current Dockerfile
  never copies the root `.env` into a layer, so no key is leaked today, but it is
  cheap to exclude it before that changes.
- **Weak test assertions.** `backend/tests/test_ai_connectivity.py:40-79` is
  named "applies a board update" but uses empty columns and cards and never reads
  the database back, so it would pass even if persistence were removed.
  `frontend/src/components/KanbanBoard.test.tsx:60-75` asserts only that
  `saveBoard` was called, not that the renamed column was in the payload.
- **Documentation drift.** `docs/DATABASE_SCHEMA.md:5` says the database lives in
  the project root; `backend/app/main.py:14` puts it under `backend/`.
  `docs/PLAN.md` claims malformed provider payloads surface as 502 (finding 7)
  and that tests never touch the real database (finding 10). `backend/AGENTS.md`
  and `scripts/AGENTS.md` are still one-line placeholders. There is no root
  README or runbook covering Docker versus local startup, the demo credentials,
  the need to build the frontend before `/` serves anything, where the data
  lives, and the loopback-only boundary.

## What is solid

Worth keeping as is: the pure `moveCard` reducer in `lib/kanban.ts`, tested
independently of React; parameterized SQL throughout; connections closed via
`contextlib.closing`; the clean separation of API helpers in `lib/api.ts`; the
real structured-output request with a strict JSON schema rather than a
prompt-only contract; and the array-versus-dictionary conversion that keeps the
external API shape stable across that boundary. The problems above are about
persistence and lifecycle contracts, not about the shape of the architecture -
none of the recommended fixes require a rewrite.

## Verification performed

| Check | Result |
| --- | --- |
| `pytest` (backend) | 10 passed. Deprecation warnings only, from installed dependencies. |
| `vitest run` (frontend) | 8 passed across 2 files. |
| `npm run lint` | Clean. |
| `npx tsc --noEmit` | Clean. |
| `npm run build` | Fails on this host fetching Google Fonts (TLS); see P3. |
| Backend validation and error probes | Confirmed acceptance and persistence of `{}`, dangling `cardIds`, and silently collapsed duplicate ids; confirmed 500s for four malformed provider shapes; confirmed `board_update: {}` is returned to the client. Mocked provider, disposable SQLite files. |
| Backend import-time DB probe | Confirmed importing `app.main` creates the database before any fixture runs. |
| Backend scheduling probe | Confirmed a 250 ms blocking provider call delayed a 10 ms coroutine to 251 ms. |
| Frontend reproduction probes | 5 probes confirmed: save-before-load, dangling-reference render crash, `board_update: {}` render crash, AI reply overwriting an in-flight edit, logout discarding a pending edit. Mocked API and deferred promises; all probe files removed afterwards. |
| PowerShell reserved-variable probe | Confirmed the `$pid` assignment failure without stopping any process. |
| Docker, Compose, script review | Static configuration and Git file-mode inspection only. |

**Not run:** Docker build or container recreation, destructive start/stop
exercises, Playwright E2E, a live OpenRouter call, a rendered accessibility
audit, dependency vulnerability scanning, or anything on macOS or Linux. Earlier
live-test claims in `docs/PLAN.md` were treated as historical documentation, not
as verification performed here.

## Suggested repair order

1. Stop losing data: gate autosave on a completed load (1), then fix the
   logout/pending-save behavior and the AI-versus-edit race together (3, 8).
2. Validate boards once, at both persistence boundaries, and normalize the
   empty-update case on both sides of the API (2, 7).
3. Persist the database across container recreation and restrict the published
   port to loopback (4, 5).
4. Take the provider call off the event loop (6).
5. Fix the script lifecycle bugs (12, 13, 14) and give the test suites real
   isolation (10, 11), then add regressions for every failure reproduced above.
