# Frontend

A NextJS app built as a static export (`output: "export"` in
`next.config.ts`) so the backend can serve it as plain files at `/`. In dev,
`next.config.ts` rewrites `/api/*` to `http://localhost:8000`, matching the
port every backend start script uses.

## Structure

- `src/app/page.tsx` renders `Workspace`; `layout.tsx` sets up fonts and
  metadata.
- `src/lib/types.ts` mirrors the API payloads.
- `src/lib/api.ts` is the typed client. It keeps the bearer token in a module
  variable set through `setAuthToken`, and throws `ApiError` carrying the
  HTTP status so callers can tell an auth failure from a validation one.
- `src/lib/board.ts` is the pure logic, unit-tested on its own: drag-id
  encoding, `resolveDrop` (which column and slot a drop maps to),
  `withCardMoved` (the optimistic local move), filtering, and the small
  presentation helpers.
- `src/lib/session.ts` persists the session in localStorage. Every access is
  wrapped, because storage can be blocked or absent.
- `src/components/Workspace.tsx` is the root: it restores and revalidates a
  stored session, then switches between the board list, a board, and the
  account page.
- `BoardView.tsx` owns the open board. `BoardColumn.tsx` and `BoardCard.tsx`
  render it, `CardDrawer.tsx` edits one card, `BoardSidebar.tsx` holds stats,
  members, labels, archived cards, and activity, and `ChatPanel.tsx` is the
  assistant.
- `ui.tsx` has the shared primitives (button, input, field, modal, badge).

## Behavior

- Every mutation calls the API and replaces the board with what comes back,
  so there is no client-side merging and no autosave debounce to go stale.
- A drag applies locally first so it feels instant, then reconciles with the
  server's board. If the server refuses (a WIP limit, say), the board is
  refetched and the message explaining why stays on screen.
- Cards can be dragged with the pointer or the keyboard: space to pick up,
  arrows to move, space to drop.
- What a viewer can do is driven by `board.role`; editing controls are not
  rendered at all rather than disabled.

## Testing

- Unit/integration tests (vitest + Testing Library) live next to their
  source. `src/test/factories.ts` builds fixtures — `boardWithCards` gives
  columns 1..n holding card ids 101, 102, and so on.
- `src/test/setup.ts` stands up `localStorage` and `scrollIntoView`, which
  this jsdom build does not provide.
- `BoardView.dnd.test.tsx` stubs `DndContext` to call the drag handlers
  directly, because real pointer dragging needs layout jsdom does not have.
- Playwright specs in `tests/` drive a real browser against a real backend
  that Playwright starts itself, against a throwaway database.
- Coverage thresholds are enforced in `vitest.config.ts`.
