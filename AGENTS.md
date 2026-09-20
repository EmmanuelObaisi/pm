# The Project Management web app

## Business Requirements

This project is building a Project Management App. Key features:
- Users register and sign in; sessions survive a reload
- A user has many Kanban boards and can share them with other users as
  editors or viewers
- Boards have columns (renamable, reorderable, with optional WIP limits) and
  cards with description, assignee, due date, priority, estimate, labels,
  checklist, and comments
- Cards move with drag and drop, and can be filtered and searched
- Each board has an activity feed and stats
- Admins can deactivate and promote accounts
- There is an AI chat sidebar scoped to a board; the AI reads the board and
  changes it through explicit operations on cards and columns

## Limitations

This runs locally (in a docker container).

The MVP limits (one hardcoded `user`/`password` account, one board per user)
were lifted deliberately; see `docs/UPGRADE_PLAN.md`. A fresh instance still
seeds a `user` / `password` admin account so it is usable immediately, and
databases from the MVP are migrated to the current schema on first open.

## Technical Decisions

- NextJS frontend
- Python FastAPI backend, including serving the static NextJS site at /
- Everything packaged into a Docker container
- Use "uv" as the package manager for python in the Docker container
- Use OpenRouter for the AI calls. An OPENROUTER_API_KEY is in .env in the project root
- Use `openai/gpt-oss-120b` as the model
- Use SQLLite local database for the database, creating a new db if it doesn't exist
- Start and Stop server scripts for Mac, PC, Linux in scripts/

## Starting Point

A working MVP of the frontend has been built and is already in frontend. This is not yet designed for the Docker setup. It's a pure frontend-only demo.

## Color Scheme

- Accent Yellow: `#ecad0a` - accent lines, highlights
- Blue Primary: `#209dd7` - links, key sections
- Purple Secondary: `#753991` - submit buttons, important actions
- Dark Navy: `#032147` - main headings
- Gray Text: `#888888` - supporting text, labels

## Coding standards

1. Use latest versions of libraries and idiomatic approaches as of today
2. Keep it simple - NEVER over-engineer, ALWAYS simplify, NO unnecessary defensive programming. No extra features - focus on simplicity.
3. Be concise. Keep README minimal. IMPORTANT: no emojis ever
4. When hitting issues, always identify root cause before trying a fix. Do not guess. Prove with evidence, then fix the root cause.

## Working documentation

All documents for planning and executing this project will be in the docs/ directory.
Please review the docs/PLAN.md document before proceeding.