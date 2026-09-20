# Project Management

A Kanban project management app: NextJS frontend, FastAPI backend, SQLite,
with an AI assistant that can read and change a board.

- Accounts with registration, sign-in, and sessions that survive a reload
- Many boards per user, shared with others as editor or viewer
- Columns with optional WIP limits; cards with description, assignee, due
  date, priority, estimate, labels, checklist, and comments
- Drag and drop with the pointer or the keyboard, search and filters
- Per-board stats, activity feed, and archive
- An AI sidebar that changes the board through validated operations

## Running it

```
docker compose up --build
```

Then open http://localhost:8000. A fresh instance seeds a `user` /
`password` admin account.

Set `OPENROUTER_API_KEY` in a root `.env` for the assistant, and `JWT_SECRET`
to anything private if this is not just running on your own machine.

## Developing

Backend, from `backend/`:

```
pip install -r requirements-dev.txt
python -m uvicorn app.main:app --reload --port 8000
pytest
```

Frontend, from `frontend/`:

```
npm install
npm run dev          # proxies /api to port 8000
npm run test         # unit and integration
npm run test:e2e     # playwright; starts its own servers
```

## Documentation

- `AGENTS.md` — requirements and technical decisions
- `CLAUDE.md` — how the code is laid out and how to work on it
- `docs/UPGRADE_PLAN.md` — the plan that took this past its MVP shape
- `docs/DATABASE_SCHEMA.md` — the schema and the migration from the MVP
