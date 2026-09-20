# Project code review

Review date: 14 September 2026. Scope: the current working tree, not only the latest commit.

## Assessment

The project has a small, understandable MVP architecture and passing happy-path tests. However, it should not yet be trusted with important board data: initial loading, AI updates, and container recreation can lose work. Backend validation and local network exposure also need attention.

This review covers first-party frontend and backend code, tests, database storage, AI integration, Docker packaging, platform scripts, dependency configuration, and project documentation. Generated assets and third-party dependency implementations were not audited. No application fixes were made. The previously deleted `docs/code_review.md` was recreated as requested; temporary review probes were removed.

The plan explicitly accepts demo-only client-side sign-in, a single board per user, SQLite, and no multi-user conflict merging. Those are not independently classified as defects here. Single-tab data loss and exposing unauthenticated APIs beyond the local machine are separate issues. Recommendations retain the MVP scope rather than proposing a production authentication system or a new database architecture.

Priorities: **P1 / high** means address before relying on the MVP with real data; **P2 / medium** means fix in the next reliability pass; **P3 / low** means maintenance or usability follow-up. Findings marked reproduced were exercised locally; static findings identify a code path but were not reproduced end-to-end.

## P1 findings

### 1. Docker container recreation loses the SQLite database

**Locations:** `docker-compose.yml:1-11`; `Dockerfile:20-26`; `backend/app/main.py:13-16`.

The database lives at `/app/backend/project_management.db` inside the container, but Compose defines no persistent volume. Stopping and starting the same container retains data; removing/recreating it, including `docker compose down` followed by `up`, does not. A rebuild that recreates the container has the same risk.

**Evidence:** static inspection of the database path and complete Compose configuration. No existing container was removed during this review.

**Recommendation:** configure a dedicated database directory, such as `/data`, and mount a named volume there. Do not mount over the application source directory. Document the data location and backup procedure. Verify that a distinctive saved card survives container recreation with the same volume.

### 2. Sign-in can overwrite saved work before the board finishes loading

**Location:** `frontend/src/components/KanbanBoard.tsx:52-98`.

Signing in starts both the GET and the autosave effect. After 150 ms, autosave sends the current local board, initially the demo data, even if the GET is still pending. The flag preventing a save is set only when the GET resolves. The UI can therefore show the previously saved board while the server has already been overwritten with demo data. If loading fails, saving the fallback board remains enabled.

**Evidence:** reproduced with a deferred `fetchBoard` promise and fake timers. Before resolving the GET, `saveBoard("user", initialData)` was called; after resolving it with distinct saved content, no corrective save occurred.

**Recommendation:** gate editing and autosave on successful initial loading. Keep a failed load in an explicit error/retry state rather than treating fallback data as a loaded board. Add delayed and rejected GET tests that assert no PUT occurs before successful loading.

### 3. Invalid API and AI boards are persisted and can break the UI

**Locations:** `backend/app/main.py:138-149,294-296,315-349`; `frontend/src/components/KanbanBoard.tsx:361,388-392`; `frontend/src/components/KanbanColumn.tsx:53-59`.

The PUT endpoint accepts any JSON object. AI output is parsed but never validated locally against its structural or relational contract. The strict provider schema does not guarantee unique IDs, valid card references, or retention of the fixed columns. Converting the AI card array to a dictionary also silently collapses duplicate IDs.

**Evidence:** reproduced against a disposable database:

- `PUT /api/board?user=review` with `{}` returned 200, and GET returned `{}`. The frontend subsequently assumes `board.columns` exists.
- A mocked AI response containing `cardIds: ["missing"]` and an empty card array returned 200 and was persisted. Rendering that column dereferences `undefined.id`.
- The current provider schema permits empty columns and arbitrary replacement column IDs, despite the fixed-column requirement.

**Recommendation:** use typed request/response models and one shared board validator at persistence boundaries. Validate required fields, unique IDs, dictionary key/ID agreement, card membership, and the fixed column identities while permitting renames. Reject invalid client input with 422 and invalid provider output with 502, leaving the saved board unchanged. Add tests using dangling references, duplicate IDs, and removed columns, not only empty-board fixtures.

### 4. An AI response overwrites edits made while it is pending

**Locations:** `frontend/src/components/KanbanBoard.tsx:128-171,379-407`; `backend/app/main.py:338-347`.

The AI receives a snapshot of the board. The board remains editable while the request runs, then the response replaces the whole board. The backend also persists that snapshot-derived update before returning it. A user can lose a card edit or addition in a single browser tab without any second user involved.

**Evidence:** reproduced by requesting an AI rename of Done, changing Backlog locally while the request was pending, then resolving the AI response. The newer local column title reverted to Backlog.

**Plan qualification:** `docs/PLAN.md` acknowledges replacement rather than merging. Its single-user justification does not prevent this same-tab interleaving. A merge engine is not required to address it.

**Recommendation:** for this MVP, disable board mutations while AI runs and coordinate pending saves before sending the AI request. Alternatively, add revision checks before persistence and replacement. Rejecting a stale response only in the browser is insufficient because the backend has already saved it. Test an edit immediately before submission and attempted edits during the request.

### 5. The unauthenticated local app is published on all interfaces

**Locations:** `docker-compose.yml:6-10`; `scripts/start.sh:7`; `scripts/start.ps1:6`; `scripts/start.bat:7`; `start-dev-combined.ps1:51`; `backend/app/main.py:289-316`.

Compose publishes `8000:8000`, and native launchers bind Uvicorn to `0.0.0.0`. The sign-in gate is only in React; backend routes accept caller-selected usernames without authentication. If the machine's firewall/network permits access, another host can read or replace boards and invoke AI requests using the configured OpenRouter key.

**Evidence:** static configuration and route inspection. External reachability was not tested, so this is conditional on the host network/firewall.

**Recommendation:** publish `127.0.0.1:8000:8000` in Compose and use loopback for native development servers. Keep `0.0.0.0` inside the Docker container, where it is necessary for published-port access. Also constrain the Next development server if it is intended to be local-only. Real authentication is required before deliberate shared/network deployment, not as an extra requirement for this loopback-only demo.

### 6. AI calls block the backend event loop

**Locations:** `backend/app/main.py:152-189,299-303,315-338`.

Both AI handlers are `async def` but call synchronous `httpx.post` directly, with a 30-second timeout. While a provider call blocks, the default single Uvicorn worker cannot service unrelated requests, including autosave and health checks. SQLite operations are synchronous on the same event loop as well, although normally much shorter.

**Evidence:** a controlled coroutine probe replaced the provider call with a 250 ms blocking delay. A health coroutine scheduled for 10 ms completed after approximately 277 ms. No real OpenRouter request was made.

**Recommendation:** the smallest change is to make wholly synchronous handlers regular `def` handlers so FastAPI dispatches them to its worker pool. Alternatively, use an awaited `httpx.AsyncClient` and handle blocking database operations separately. Add a concurrent-request test showing health and board access remain responsive during a delayed AI response.

## P2 findings

### 7. Autosave is neither flushed on logout nor ordered across requests

**Location:** `frontend/src/components/KanbanBoard.tsx:81-98,112-126`.

The debounce cleanup discards any edit not yet sent when the user logs out. Closing or reloading the page before the timer fires has the same risk. Once a save has started, later saves can overlap: clearing the timeout does not cancel or serialize an HTTP request. With delayed/reordered delivery, an older board can be applied last. Completion callbacks can also clear a newer error. A failed save is retried only after another edit.

**Evidence:** immediate edit followed by logout was reproduced with fake timers; no save occurred after advancing beyond the debounce. Overlapping request ordering and retry behavior were established by source inspection, not reproduced over a real network. A reversed response order alone would not prove reversed database writes.

**Recommendation:** keep explicit loaded/dirty/saving state, serialize saves while coalescing pending edits, and await the latest save before completing logout. Warn before leaving with unsaved work or use an appropriate unload persistence mechanism. Offer retry after failure without requiring another edit. Test deferred saves with asymmetric board values and verify the final persisted value.

### 8. AI completions are not isolated from logout and later sign-in

**Location:** `frontend/src/components/KanbanBoard.tsx:112-126,155-184`.

Logout resets chat text but does not invalidate the active request or reset `isAiLoading`. An old request can later append an assistant message, set an error, or replace the board after logout or after signing in again. The initial board-loading effect has an `ignore` guard; the AI path does not.

**Evidence:** static tracing of logout and asynchronous completion handlers.

**Recommendation:** use a session/request generation guard and reset pending UI state on logout. Decide explicitly whether to wait for an already-persisting AI operation before logout. Browser cancellation does not undo a server-side write. Test logout/relogin with both delayed AI success and delayed failure.

### 9. Malformed provider responses escape the promised error handling

**Locations:** `backend/app/main.py:185-189,299-303,338-349`.

The HTTP response's `json()` call is outside the exception handler. Model content is not checked for string type, and parsed model JSON is assumed to be an object. Only malformed JSON text is caught. Some invalid shapes are instead accepted, such as an empty object for `board_update`.

**Evidence:** mocked-provider probes returned 500 for a non-JSON HTTP 200 body, null message content, and model JSON `[]` or `null`. `{"reply":"ok","board_update":{}}` returned 200. This contradicts the plan's broader claim that malformed provider payloads surface as 502.

**Recommendation:** validate the provider envelope and structured content before reading or persisting them; consistently map invalid upstream responses to a useful 502. Share this validation with finding 3. Ensure malformed output never changes the database.

### 10. The PowerShell stop script fails before stopping the server

**Location:** `scripts/stop.ps1:9-12`.

PowerShell variable names are case-insensitive. `$pid` is the built-in, read-only `$PID`, so assigning the owning process ID throws whenever the script finds a connection. With `$ErrorActionPreference = "Stop"`, the script exits before `Stop-Process`.

**Evidence:** safely reproduced the assignment alone; PowerShell returned `Cannot overwrite variable PID because it is read-only or constant.` No process was stopped.

**Recommendation:** use a name such as `$processId`, together with the ownership check in finding 11. Test the script with a disposable project process and with no process running.

### 11. Stop scripts identify the application only by its port

**Locations:** `scripts/stop.bat:4-6`; `scripts/stop.sh:4-7`; `scripts/stop.ps1:3-12`.

The scripts terminate processes using port 8000 without checking their ownership. If another application occupies that port, the stop command can terminate it. The Unix `lsof -ti :8000` query can also match a client connected to the port, not only the listener. The PowerShell variant currently fails earlier as described above, but renaming its variable alone would expose this behavior.

**Evidence:** static inspection; no destructive stop command was executed.

**Recommendation:** track and verify the project's launched process, or use Compose lifecycle commands for the Docker workflow. Verify that an unrelated disposable listener remains running when the project is stopped.

### 12. The combined development launcher can send API requests to the wrong service

**Locations:** `start-dev-combined.ps1:19-24,48-59`; `frontend/next.config.ts:8-14`.

The script chooses another backend port when 8000 is occupied, but the Next proxy always targets `http://localhost:8000`. The frontend therefore reaches the old service or fails rather than using the newly launched backend. The script also hardcodes one user's repository path and Python installation, so it is not portable to another checkout.

**Evidence:** static comparison of port selection, launcher arguments, and proxy destination.

**Recommendation:** either fail clearly when the required port is occupied or pass the selected backend origin into Next configuration. Derive paths from `$PSScriptRoot` and use a documented interpreter/virtual environment. Verify the occupied-port case, not only the default case.

### 13. Test isolation is incomplete and the suite can miss persistence failures

**Locations:** `backend/tests/conftest.py:3-8`; `backend/app/main.py:361`; `frontend/playwright.config.ts:13-18`; `frontend/tests/kanban.spec.ts:3-62`.

Backend test collection imports `main`, which calls `init_db()` before the fixture replaces `DB_PATH`. A normal test run can therefore create or perform schema initialization against the real database. Subsequent test requests are isolated, but the plan's claim that tests never touch that database is too strong.

Playwright starts only Next and reuses an existing frontend server. It neither provisions an isolated backend nor resets its board data. When a real backend is available, tests modify the shared demo user's board. The editing test assumes the original `card-1` title, so persisted changes can make later runs fail. Without a backend, some checks can pass against the local fallback board instead of proving integration.

**Evidence:** import order, fixture timing, and E2E setup/assertion inspection. Backend tests in this review intercepted SQLite connections during import to avoid touching the real database.

**Recommendation:** initialize the database after configurable test settings are applied, preferably through app startup/app creation. Give E2E runs a disposable backend/database and deterministic seed state. Assert successful loading, wait for persistence, reload/re-sign in, and confirm exact saved values. Do not use the user's running application as a test fixture.

### 14. Card movement is unavailable to keyboard-only users

**Locations:** `frontend/src/components/KanbanBoard.tsx:44-48`; `frontend/src/components/KanbanCard.tsx:83-92`.

Only `PointerSensor` is registered. Although Move is a focusable button, there is no keyboard sensor or alternative control for moving cards between columns.

**Evidence:** static sensor/control inspection; no assistive-technology session was run.

**Recommendation:** add a keyboard sensor with suitable sortable coordinates, or provide a simple Move-to-column control. Test starting, completing, and cancelling a move without a pointer.

## P3 follow-ups

- **Launcher output and lock handling:** `start-dev-combined.ps1:38-41,57` removes a Next lock without establishing that its owner is stopped. Lines 63 and 68 repeatedly use `Receive-Job -Keep`, replaying all accumulated logs every second; URLs at lines 87-89 appear only after the job loop exits. Preserve live locks, consume each log once, and print URLs when launching.
- **Mac/Linux invocation:** Git records both shell scripts as `100644`, so direct `./scripts/start.sh` / `./scripts/stop.sh` invocation fails on a normal Unix checkout. Either commit executable mode or explicitly document `bash scripts/start.sh`. Native scripts assume dependencies and a suitable `python` command exist; document setup and supported interpreters rather than assuming every Mac provides `python`.
- **Build reproducibility:** `Dockerfile:3-4` uses `npm install` despite a committed lock; prefer `npm ci` so a mismatched manifest fails instead of updating resolution. `backend/requirements.txt:1-5` pins only direct dependencies and includes pytest in the runtime image; lock transitive dependencies with uv and separate test dependencies when convenient. Floating base/tool versions make rebuilds time-dependent. No vulnerability or latest-version claim is made by this review.
- **Secret exclusion:** `.dockerignore:1-13` does not exclude `.env`, although `.gitignore` does. Exclude `.env` and secret variants from eligible build-context files, preserving an explicitly allowed example if needed. The current Dockerfile does not explicitly copy the root `.env` into an image; an actual key leak was not observed.
- **Runbook accuracy:** `docs/DATABASE_SCHEMA.md:5` says the database is in the project root, but `backend/app/main.py:14` puts it under `backend`. Native start scripts launch only the backend; on a fresh clone without `frontend/out`, `/` returns 404. Add a concise runbook covering Docker versus development startup, prerequisites, frontend export, credentials, shutdown, data persistence, and the loopback-only boundary. Backend guidance remains a placeholder.
- **Test assertions:** `backend/tests/test_ai_connectivity.py:40-79` names a board-update test but uses empty columns/cards and never reads the database afterward. `frontend/src/components/KanbanBoard.test.tsx:60-75` checks that saving happened, not that the renamed column was sent. Use distinctive before/after values and persistence assertions; retain the existing reducer and edit-payload tests.

## Verification performed

| Check | Result |
| --- | --- |
| Existing backend suite | 10 passed; warnings from pytest import rewriting and installed dependencies. Run through an in-memory wrapper that redirected import-time SQLite connections to temporary storage, followed by the existing per-test DB fixture. |
| Existing frontend unit/component suite (`npm run test:unit`) | 8 passed across 2 files. |
| Frontend lint (`npm run lint`) | Passed. |
| Frontend TypeScript (`npx tsc --noEmit`) | Passed. |
| Temporary frontend reproduction probes | 3 passed, confirming the current bugs: save-before-load, AI overwriting an intervening local edit, and logout dropping a pending edit. Probes used mocked APIs/fake timers and were removed afterward. These are bug reproductions, not evidence that behavior is correct. |
| Backend validation/error probes | Confirmed acceptance and persistence of invalid boards, malformed-provider 500s, and acceptance of an empty update object, using mocked AI and disposable SQLite files. |
| Backend scheduling probe | Confirmed a blocking provider call delayed an unrelated coroutine. |
| PowerShell reserved-variable probe | Confirmed the stop-script assignment failure without stopping any process. |
| Docker/Unix script review | Static configuration and Git file-mode inspection only. |

Not run: Docker build/recreation, destructive start/stop exercises, production frontend build, Playwright E2E, a rendered visual/accessibility audit, a live OpenRouter call, dependency vulnerability scanning, or testing on Mac/Linux. The plan's earlier live-test claims were treated as historical documentation, not as verification performed here. No real application data or API key was needed for these checks.

## Suggested repair order

1. Preserve the SQLite database across container recreation and restrict host exposure to loopback.
2. Fix load-before-save, pending-save/logout behavior, and the single-tab AI/edit race together.
3. Validate board and provider data before persistence; keep unrelated requests responsive during AI calls.
4. Repair script lifecycle behavior and isolate integration tests, then add regressions for the reproduced failures.

The existing pure drag reducer, parameterized SQL, separation of API helpers, and explicit structured-output request are useful foundations. Keep those simple boundaries; the main need is stronger persistence/lifecycle contracts and tests around failure paths, not a broad architectural rewrite.
