# Upgrade plan: MVP to comprehensive project management app

Supersedes the MVP limits in `AGENTS.md` (single hardcoded user, one board per
user) at the user's explicit request. Everything else in `AGENTS.md` still
holds: SQLite, Docker, OpenRouter with `openai/gpt-oss-120b`, no emojis, keep
it simple, root-cause debugging.

## Target feature set

- Real user management: register, login, JWT session, profile, password
  change, admin user administration, soft deactivation.
- Multiple boards per user, plus board sharing with roles (owner, editor,
  viewer).
- Normalized data model: boards, columns, cards, labels, checklists,
  comments, activity log, AI conversation per board.
- Richer cards: description, assignee, due date, priority, estimate, labels,
  checklist, comments, archive.
- Board dashboard, per-board stats, activity feed, card filtering and search.
- AI assistant scoped to a board that emits explicit operations (create /
  update / move / delete cards, columns, labels) instead of replacing the
  whole board blob.

## Phases

1. Backend rewrite: modular FastAPI app, normalized SQLite schema, auth,
   boards/columns/cards/labels/comments/checklists/members/activity/stats,
   legacy DB migration, full pytest suite with coverage.
2. AI assistant rewrite onto board-scoped operations with persisted history.
3. Frontend foundation: auth screens, API client, session persistence, board
   dashboard (list, create, archive, delete).
4. Frontend board view on the new model: columns CRUD, drag and drop through
   the API, card detail drawer with all fields.
5. Frontend collaboration: members, comments, checklists, labels, activity,
   filters and search, stats panel.
6. Test hardening: backend coverage target, frontend unit/integration tests,
   Playwright e2e over register -> board -> card -> AI flows.
7. Docs, Docker, and dev script updates.

## Status

- [ ] Phase 1 backend rewrite
- [ ] Phase 2 AI operations
- [ ] Phase 3 frontend foundation
- [ ] Phase 4 frontend board view
- [ ] Phase 5 frontend collaboration
- [ ] Phase 6 test hardening
- [ ] Phase 7 docs and packaging
