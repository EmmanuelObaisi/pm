import { describe, expect, it } from "vitest";

import {
  applyFilters,
  canEdit,
  cardDragId,
  cardsInColumn,
  columnDragId,
  columnOfCard,
  emptyFilters,
  formatDate,
  hasActiveFilters,
  isNoOpMove,
  isOverdue,
  isOverWipLimit,
  isOwner,
  matchesFilters,
  parseDragId,
  resolveDrop,
  withCardMoved,
} from "@/lib/board";
import { boardWithCards, makeBoard, makeCard, makeColumn } from "@/test/factories";

describe("drag ids", () => {
  it("round-trips a card id", () => {
    expect(parseDragId(cardDragId(12))).toEqual({ kind: "card", id: 12 });
  });

  it("round-trips a column id", () => {
    expect(parseDragId(columnDragId(3))).toEqual({ kind: "column", id: 3 });
  });

  it("rejects ids it does not recognise", () => {
    expect(parseDragId("widget:1")).toBeNull();
    expect(parseDragId("card:abc")).toBeNull();
    expect(parseDragId("nonsense")).toBeNull();
  });
});

describe("card lookup", () => {
  const board = boardWithCards([["A", "B"], ["C"], []]);

  it("lists a column's cards in order", () => {
    expect(cardsInColumn(board, 1).map((card) => card.title)).toEqual(["A", "B"]);
  });

  it("returns nothing for an empty or unknown column", () => {
    expect(cardsInColumn(board, 3)).toEqual([]);
    expect(cardsInColumn(board, 999)).toEqual([]);
  });

  it("skips ids with no matching card", () => {
    const broken = makeBoard({
      columns: [makeColumn({ id: 1, card_ids: [101, 999] })],
      cards: [makeCard({ id: 101, column_id: 1, title: "Only real card" })],
    });
    expect(cardsInColumn(broken, 1).map((card) => card.title)).toEqual([
      "Only real card",
    ]);
  });

  it("finds the column holding a card", () => {
    expect(columnOfCard(board, 103)?.id).toBe(2);
    expect(columnOfCard(board, 999)).toBeUndefined();
  });
});

describe("resolveDrop", () => {
  const board = boardWithCards([["A", "B", "C"], ["D"], []]);

  it("drops onto an empty column at slot zero", () => {
    expect(resolveDrop(board, cardDragId(101), columnDragId(3))).toEqual({
      cardId: 101,
      columnId: 3,
      position: 0,
    });
  });

  it("appends when dropped on a column that already has cards", () => {
    expect(resolveDrop(board, cardDragId(101), columnDragId(2))).toEqual({
      cardId: 101,
      columnId: 2,
      position: 1,
    });
  });

  it("inserts at the target card's slot in another column", () => {
    expect(resolveDrop(board, cardDragId(101), cardDragId(104))).toEqual({
      cardId: 101,
      columnId: 2,
      position: 0,
    });
  });

  it("uses the slot with the dragged card removed when reordering", () => {
    // A (101) dropped on C (103): with A removed the column is [B, C], so C is slot 1.
    expect(resolveDrop(board, cardDragId(101), cardDragId(103))).toEqual({
      cardId: 101,
      columnId: 1,
      position: 1,
    });
  });

  it("moves a card up within its column", () => {
    // C (103) dropped on A (101): with C removed the column is [A, B], A is slot 0.
    expect(resolveDrop(board, cardDragId(103), cardDragId(101))).toEqual({
      cardId: 103,
      columnId: 1,
      position: 0,
    });
  });

  it("treats a card dropped on itself as no move", () => {
    expect(resolveDrop(board, cardDragId(101), cardDragId(101))).toBeNull();
  });

  it("ignores drops that are not a card being dragged", () => {
    expect(resolveDrop(board, columnDragId(1), columnDragId(2))).toBeNull();
    expect(resolveDrop(board, "junk", columnDragId(2))).toBeNull();
    expect(resolveDrop(board, cardDragId(101), "junk")).toBeNull();
  });

  it("ignores a card that is not on the board", () => {
    expect(resolveDrop(board, cardDragId(999), columnDragId(1))).toBeNull();
  });

  it("ignores a drop onto a card that is not on the board", () => {
    expect(resolveDrop(board, cardDragId(101), cardDragId(999))).toBeNull();
  });
});

describe("withCardMoved", () => {
  const board = boardWithCards([["A", "B", "C"], ["D"], []]);

  it("moves a card to another column and updates its column_id", () => {
    const next = withCardMoved(board, 101, 2, 0);
    expect(next.columns[0].card_ids).toEqual([102, 103]);
    expect(next.columns[1].card_ids).toEqual([101, 104]);
    expect(next.cards.find((card) => card.id === 101)?.column_id).toBe(2);
  });

  it("reorders within a column", () => {
    expect(withCardMoved(board, 103, 1, 0).columns[0].card_ids).toEqual([
      103, 101, 102,
    ]);
  });

  it("clamps a slot past the end", () => {
    expect(withCardMoved(board, 101, 1, 99).columns[0].card_ids).toEqual([
      102, 103, 101,
    ]);
  });

  it("clamps a negative slot", () => {
    expect(withCardMoved(board, 103, 1, -5).columns[0].card_ids).toEqual([
      103, 101, 102,
    ]);
  });

  it("leaves the board alone for an unknown column", () => {
    expect(withCardMoved(board, 101, 999, 0)).toBe(board);
  });

  it("does not mutate the board it was given", () => {
    withCardMoved(board, 101, 2, 0);
    expect(board.columns[0].card_ids).toEqual([101, 102, 103]);
    expect(board.columns[1].card_ids).toEqual([104]);
  });
});

describe("isNoOpMove", () => {
  const board = boardWithCards([["A", "B", "C"], ["D"]]);

  it("detects a drop that changes nothing", () => {
    expect(isNoOpMove(board, 101, 1, 0)).toBe(true);
    expect(isNoOpMove(board, 102, 1, 1)).toBe(true);
  });

  it("detects a real move", () => {
    expect(isNoOpMove(board, 101, 1, 2)).toBe(false);
    expect(isNoOpMove(board, 101, 2, 0)).toBe(false);
  });

  it("is false for a card that is not in the target column", () => {
    expect(isNoOpMove(board, 999, 1, 0)).toBe(false);
    expect(isNoOpMove(board, 101, 999, 0)).toBe(false);
  });
});

describe("filters", () => {
  const board = boardWithCards([["Alpha task", "Beta task"], ["Gamma task"]]);
  board.cards[0].priority = "urgent";
  board.cards[0].assignee_id = 7;
  board.cards[0].label_ids = [50];
  board.cards[1].details = "mentions gamma in the body";

  it("treats empty filters as inactive", () => {
    expect(hasActiveFilters(emptyFilters)).toBe(false);
    expect(applyFilters(board, emptyFilters)).toBe(board);
  });

  it("notices each kind of active filter", () => {
    expect(hasActiveFilters({ ...emptyFilters, search: "a" })).toBe(true);
    expect(hasActiveFilters({ ...emptyFilters, assigneeId: 1 })).toBe(true);
    expect(hasActiveFilters({ ...emptyFilters, priority: "low" })).toBe(true);
    expect(hasActiveFilters({ ...emptyFilters, labelId: 2 })).toBe(true);
    expect(hasActiveFilters({ ...emptyFilters, search: "   " })).toBe(false);
  });

  it("searches titles case-insensitively", () => {
    const filtered = applyFilters(board, { ...emptyFilters, search: "ALPHA" });
    expect(filtered.columns[0].card_ids).toEqual([101]);
    expect(filtered.columns[1].card_ids).toEqual([]);
  });

  it("searches card details too", () => {
    const filtered = applyFilters(board, { ...emptyFilters, search: "gamma" });
    expect(filtered.columns[0].card_ids).toEqual([102]);
    expect(filtered.columns[1].card_ids).toEqual([103]);
  });

  it("filters by assignee, priority, and label", () => {
    expect(applyFilters(board, { ...emptyFilters, assigneeId: 7 }).columns[0].card_ids)
      .toEqual([101]);
    expect(applyFilters(board, { ...emptyFilters, priority: "urgent" }).columns[0].card_ids)
      .toEqual([101]);
    expect(applyFilters(board, { ...emptyFilters, labelId: 50 }).columns[0].card_ids)
      .toEqual([101]);
  });

  it("combines filters with AND", () => {
    const filtered = applyFilters(board, {
      ...emptyFilters,
      search: "alpha",
      priority: "low",
    });
    expect(filtered.columns.every((column) => column.card_ids.length === 0)).toBe(true);
  });

  it("leaves the cards array untouched so lookups still work", () => {
    const filtered = applyFilters(board, { ...emptyFilters, search: "alpha" });
    expect(filtered.cards).toHaveLength(3);
  });

  it("matchesFilters covers a single card", () => {
    expect(matchesFilters(board.cards[0], { ...emptyFilters, priority: "urgent" })).toBe(
      true
    );
    expect(matchesFilters(board.cards[1], { ...emptyFilters, priority: "urgent" })).toBe(
      false
    );
  });
});

describe("presentation helpers", () => {
  const today = new Date("2026-06-15T12:00:00Z");

  it("flags only past due dates", () => {
    expect(isOverdue(makeCard({ due_date: "2026-06-14" }), today)).toBe(true);
    expect(isOverdue(makeCard({ due_date: "2026-06-15" }), today)).toBe(false);
    expect(isOverdue(makeCard({ due_date: "2026-06-16" }), today)).toBe(false);
    expect(isOverdue(makeCard({ due_date: null }), today)).toBe(false);
  });

  it("does not flag an archived card as overdue", () => {
    expect(isOverdue(makeCard({ due_date: "2020-01-01", archived: true }), today)).toBe(
      false
    );
  });

  it("reports WIP limit state", () => {
    expect(isOverWipLimit(makeColumn({ wip_limit: 2, card_ids: [1, 2] }))).toBe(false);
    expect(isOverWipLimit(makeColumn({ wip_limit: 2, card_ids: [1, 2, 3] }))).toBe(true);
    expect(isOverWipLimit(makeColumn({ wip_limit: null, card_ids: [1, 2] }))).toBe(false);
  });

  it("maps roles to capabilities", () => {
    expect(canEdit({ role: "owner" })).toBe(true);
    expect(canEdit({ role: "editor" })).toBe(true);
    expect(canEdit({ role: "viewer" })).toBe(false);
    expect(isOwner({ role: "owner" })).toBe(true);
    expect(isOwner({ role: "editor" })).toBe(false);
  });

  it("formats dates and passes through what it cannot parse", () => {
    expect(formatDate("2026-06-15")).toContain("2026");
    expect(formatDate(null)).toBe("");
    expect(formatDate("not a date")).toBe("not a date");
  });
});
