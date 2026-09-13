# Frontend

A NextJS app, currently a single page, built with the static export output
(`output: "export"` in `next.config.ts`) so the backend can serve it as
plain static files at `/`.

## Structure

- `src/app/page.tsx` renders the single `KanbanBoard` component; `layout.tsx`
  sets up fonts and page metadata.
- `src/components/KanbanBoard.tsx` is the whole app: the sign-in gate
  (hardcoded `user`/`password`, client-side only, no session persistence
  across reloads), the Kanban grid, and the AI chat sidebar, all as local
  component state.
- `src/components/KanbanColumn.tsx`, `KanbanCard.tsx`, `KanbanCardPreview.tsx`
  (the drag overlay preview), and `NewCardForm.tsx` make up the board UI,
  using `@dnd-kit` for drag-and-drop.
- `src/lib/kanban.ts` holds the `BoardData`/`Column`/`Card` types and the
  pure `moveCard` drag-and-drop reducer logic (columns is `Column[]`, cards
  is a `Record<id, Card>`, columns reference cards by id) — unit-tested in
  isolation (`kanban.test.ts`) separately from component tests.
- `src/lib/api.ts` wraps the three backend calls (`fetchBoard`, `saveBoard`,
  `askAI`), all relative to `/api`. In dev, `next.config.ts` rewrites
  `/api/*` to `http://localhost:8000`, matching the port every backend
  start script uses.

## Behavior

- Board changes autosave to the backend on a 150ms debounce, keyed on
  `username`.
- If the AI's `board_update` comes back non-null, the whole board is
  replaced client-side with that value (no merge).

## Testing

- Unit/integration tests (vitest + Testing Library) live next to their
  source (`*.test.ts`/`*.test.tsx`).
- Playwright e2e specs live in `tests/` and drive a real browser against a
  running dev server, including the sign-in flow.
