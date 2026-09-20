import type { Board, Card, Column, Label, Member, User } from "@/lib/types";

let nextId = 1;
export const resetIds = () => {
  nextId = 1;
};

export const makeUser = (overrides: Partial<User> = {}): User => ({
  id: nextId++,
  username: "alice",
  email: "alice@example.com",
  full_name: "Alice Example",
  is_admin: false,
  is_active: true,
  created_at: "2026-01-01T00:00:00+00:00",
  ...overrides,
});

export const makeCard = (overrides: Partial<Card> = {}): Card => ({
  id: nextId++,
  board_id: 1,
  column_id: 1,
  title: "A card",
  details: "",
  position: 0,
  priority: "medium",
  assignee_id: null,
  assignee_username: null,
  due_date: null,
  estimate: null,
  archived: false,
  label_ids: [],
  checklist: [],
  checklist_done: 0,
  checklist_total: 0,
  comment_count: 0,
  created_at: "2026-01-01T00:00:00+00:00",
  updated_at: "2026-01-01T00:00:00+00:00",
  ...overrides,
});

export const makeColumn = (overrides: Partial<Column> = {}): Column => ({
  id: nextId++,
  title: "Backlog",
  position: 0,
  wip_limit: null,
  card_ids: [],
  ...overrides,
});

export const makeLabel = (overrides: Partial<Label> = {}): Label => ({
  id: nextId++,
  name: "Bug",
  color: "#ef4444",
  ...overrides,
});

export const makeMember = (overrides: Partial<Member> = {}): Member => ({
  user_id: nextId++,
  username: "alice",
  full_name: "Alice Example",
  email: "alice@example.com",
  role: "owner",
  created_at: "2026-01-01T00:00:00+00:00",
  ...overrides,
});

export const makeBoard = (overrides: Partial<Board> = {}): Board => ({
  id: 1,
  name: "Roadmap",
  description: "",
  archived: false,
  owner_id: 1,
  owner_username: "alice",
  role: "owner",
  created_at: "2026-01-01T00:00:00+00:00",
  updated_at: "2026-01-01T00:00:00+00:00",
  columns: [],
  cards: [],
  labels: [],
  members: [],
  stats: {
    total_cards: 0,
    active_cards: 0,
    archived_cards: 0,
    overdue_cards: 0,
    total_estimate: 0,
    cards_by_column: {},
    cards_by_priority: {},
    cards_by_assignee: {},
  },
  ...overrides,
});

/**
 * A board with three columns; `layout` gives the card titles per column.
 * Card ids are 101, 102, ... in the order they appear.
 */
export const boardWithCards = (
  layout: string[][],
  overrides: Partial<Board> = {}
): Board => {
  let cardId = 100;
  const cards: Card[] = [];
  const columns = layout.map((titles, index) => {
    const columnId = index + 1;
    const ids = titles.map((title, position) => {
      cardId += 1;
      cards.push(
        makeCard({ id: cardId, column_id: columnId, title, position })
      );
      return cardId;
    });
    return makeColumn({
      id: columnId,
      title: ["Backlog", "In Progress", "Done"][index] ?? `Column ${columnId}`,
      position: index,
      card_ids: ids,
    });
  });

  return makeBoard({ columns, cards, ...overrides });
};
