import type { Board, Card, Column, Priority } from "@/lib/types";

/** Drag-and-drop ids are namespaced so a drop target can be identified. */
export const cardDragId = (cardId: number) => `card:${cardId}`;
export const columnDragId = (columnId: number) => `column:${columnId}`;

export const parseDragId = (
  id: string | number
): { kind: "card" | "column"; id: number } | null => {
  const [kind, raw] = String(id).split(":");
  const value = Number(raw);
  if ((kind !== "card" && kind !== "column") || !Number.isInteger(value)) {
    return null;
  }
  return { kind, id: value };
};

export const cardMap = (board: Board): Map<number, Card> =>
  new Map(board.cards.map((card) => [card.id, card]));

export const cardsInColumn = (board: Board, columnId: number): Card[] => {
  const column = board.columns.find((item) => item.id === columnId);
  if (!column) {
    return [];
  }
  const cards = cardMap(board);
  return column.card_ids
    .map((id) => cards.get(id))
    .filter((card): card is Card => card !== undefined);
};

export const columnOfCard = (board: Board, cardId: number): Column | undefined =>
  board.columns.find((column) => column.card_ids.includes(cardId));

/**
 * Work out the target column and slot for a drop.
 *
 * The slot is an index into the target column with the dragged card removed,
 * which is exactly what the move endpoint expects.
 */
export const resolveDrop = (
  board: Board,
  activeDragId: string,
  overDragId: string
): { cardId: number; columnId: number; position: number } | null => {
  const active = parseDragId(activeDragId);
  const over = parseDragId(overDragId);
  if (!active || !over || active.kind !== "card") {
    return null;
  }

  // Picking a card up and dropping it on itself is not a move.
  if (over.kind === "card" && over.id === active.id) {
    return null;
  }

  const source = columnOfCard(board, active.id);
  if (!source) {
    return null;
  }

  const targetColumnId =
    over.kind === "column" ? over.id : columnOfCard(board, over.id)?.id;
  if (targetColumnId === undefined) {
    return null;
  }

  const others = board.columns
    .find((column) => column.id === targetColumnId)!
    .card_ids.filter((id) => id !== active.id);

  if (over.kind === "column") {
    return { cardId: active.id, columnId: targetColumnId, position: others.length };
  }

  const index = others.indexOf(over.id);
  return {
    cardId: active.id,
    columnId: targetColumnId,
    position: index === -1 ? others.length : index,
  };
};

/** Apply a move locally so dragging feels instant before the server replies. */
export const withCardMoved = (
  board: Board,
  cardId: number,
  columnId: number,
  position: number
): Board => {
  const columns = board.columns.map((column) => ({
    ...column,
    card_ids: column.card_ids.filter((id) => id !== cardId),
  }));

  const target = columns.find((column) => column.id === columnId);
  if (!target) {
    return board;
  }
  const slot = Math.max(0, Math.min(position, target.card_ids.length));
  target.card_ids = [
    ...target.card_ids.slice(0, slot),
    cardId,
    ...target.card_ids.slice(slot),
  ];

  return {
    ...board,
    columns,
    cards: board.cards.map((card) =>
      card.id === cardId ? { ...card, column_id: columnId } : card
    ),
  };
};

export const isNoOpMove = (
  board: Board,
  cardId: number,
  columnId: number,
  position: number
): boolean => {
  const column = board.columns.find((item) => item.id === columnId);
  if (!column) {
    return false;
  }
  const current = column.card_ids.indexOf(cardId);
  if (current === -1) {
    return false;
  }
  const others = column.card_ids.filter((id) => id !== cardId);
  const slot = Math.max(0, Math.min(position, others.length));
  return current === slot;
};

// ---------------------------------------------------------------------------
// Filtering and search
// ---------------------------------------------------------------------------

export type BoardFilters = {
  search: string;
  assigneeId: number | null;
  priority: Priority | null;
  labelId: number | null;
};

export const emptyFilters: BoardFilters = {
  search: "",
  assigneeId: null,
  priority: null,
  labelId: null,
};

export const hasActiveFilters = (filters: BoardFilters): boolean =>
  filters.search.trim() !== "" ||
  filters.assigneeId !== null ||
  filters.priority !== null ||
  filters.labelId !== null;

export const matchesFilters = (card: Card, filters: BoardFilters): boolean => {
  const needle = filters.search.trim().toLowerCase();
  if (
    needle &&
    !card.title.toLowerCase().includes(needle) &&
    !card.details.toLowerCase().includes(needle)
  ) {
    return false;
  }
  if (filters.assigneeId !== null && card.assignee_id !== filters.assigneeId) {
    return false;
  }
  if (filters.priority !== null && card.priority !== filters.priority) {
    return false;
  }
  if (filters.labelId !== null && !card.label_ids.includes(filters.labelId)) {
    return false;
  }
  return true;
};

/** Narrow every column's card list to the cards that match. */
export const applyFilters = (board: Board, filters: BoardFilters): Board => {
  if (!hasActiveFilters(filters)) {
    return board;
  }
  const visible = new Set(
    board.cards.filter((card) => matchesFilters(card, filters)).map((card) => card.id)
  );
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      card_ids: column.card_ids.filter((id) => visible.has(id)),
    })),
  };
};

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export const isOverdue = (card: Card, today = new Date()): boolean => {
  if (!card.due_date || card.archived) {
    return false;
  }
  return card.due_date < today.toISOString().slice(0, 10);
};

export const isOverWipLimit = (column: Column): boolean =>
  column.wip_limit !== null && column.card_ids.length > column.wip_limit;

export const isAtWipLimit = (column: Column): boolean =>
  column.wip_limit !== null && column.card_ids.length >= column.wip_limit;

export const canEdit = (board: Pick<Board, "role">): boolean =>
  board.role === "owner" || board.role === "editor";

export const isOwner = (board: Pick<Board, "role">): boolean => board.role === "owner";

export const formatDate = (value: string | null): string => {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export const priorityRank: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};
