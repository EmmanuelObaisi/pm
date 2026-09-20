# Backend

A FastAPI app over SQLite, serving the API under `/api` and (in Docker) the
Next static export at `/`.

## Layout

- `app/config.py` — settings read from the root `.env`: JWT secret and TTL,
  PBKDF2 rounds, OpenRouter URL and model, the frontend export path.
- `app/db.py` — the schema, the `connect()` transaction helper, and
  `migrate_legacy_schema`, which upgrades an MVP database (one
  `boards.board_json` blob per user) in place on first open. `DB_PATH` can be
  overridden with `PM_DB_PATH`.
- `app/security.py` — PBKDF2-SHA256 hashing with a per-user salt, and JWT
  encode/decode.
- `app/models.py` — the pydantic request models. Optional fields that can be
  cleared use an explicit `clear_*` flag, because null alone cannot tell
  "leave this alone" from "empty it".
- `app/repository.py` — all SQL and serialization. `board_detail()` builds the
  whole-board payload that every mutating route returns, so the client never
  has to merge partial updates.
- `app/deps.py` — `get_db`, `get_current_user`, `get_current_admin`, and the
  `board_access` / `card_access` / `column_access` dependency factories.
- `app/routers/` — `auth.py` (and the admin router), `boards.py`, `cards.py`,
  `ai.py`.
- `app/ai.py` — the OpenRouter call and the operations the assistant can run.

## Conventions

- Roles are owner > editor > viewer. A request from someone who is not a
  member gets 404, not 403, so board existence does not leak.
- Routes return the whole board after a change. The exceptions are the
  comment routes (they return the card's comments) and the member routes
  (they return the member list).
- Card and column positions are 0-based and kept contiguous; archiving or
  deleting renumbers what is left.
- The connection dependency commits when a request succeeds and rolls back
  when it raises, so a route can do several writes safely.
- The AI validates every operation against the board before applying it, and
  collects failures into `errors` rather than abandoning the batch.

## Tests

`pytest` from this directory. `tests/conftest.py` gives each test its own
SQLite file and lowers the PBKDF2 rounds. The coverage gate is 90%.
