/**
 * Drag and drop, driven through the handlers BoardView hands to DndContext.
 *
 * Real pointer dragging needs layout that jsdom does not provide, so this
 * stubs DndContext to capture onDragStart/onDragEnd and calls them directly.
 * The browser-level behaviour is covered by the Playwright suite.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import { cardDragId, columnDragId } from "@/lib/board";
import type { Board } from "@/lib/types";
import { boardWithCards, makeMember, makeUser } from "@/test/factories";

vi.mock("@/lib/api");

type DragHandlers = {
  onDragStart: (event: { active: { id: string } }) => void;
  onDragEnd: (event: { active: { id: string }; over: { id: string } | null }) => void;
};

const handlers: { current: DragHandlers | null } = { current: null };

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: ({
      children,
      onDragStart,
      onDragEnd,
    }: {
      children: React.ReactNode;
    } & DragHandlers) => {
      handlers.current = { onDragStart, onDragEnd };
      return <div>{children}</div>;
    },
    DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const { BoardView } = await import("@/components/BoardView");

const currentUser = makeUser({ id: 1, username: "alice" });

const buildBoard = (): Board =>
  boardWithCards([["A", "B", "C"], ["D"], []], {
    members: [makeMember({ user_id: 1, username: "alice", role: "owner" })],
  });

const renderBoard = async (board = buildBoard()) => {
  vi.mocked(api.fetchBoard).mockResolvedValue(board);
  vi.mocked(api.fetchComments).mockResolvedValue([]);
  vi.mocked(api.fetchAIMessages).mockResolvedValue([]);
  render(<BoardView boardId={1} currentUser={currentUser} onBack={vi.fn()} />);
  await screen.findByText("A");
};

/**
 * Fires the handlers and flushes what has settled. The drop promise is not
 * awaited, so a test can also assert on a move that is still in flight.
 */
const drag = async (activeId: string, overId: string | null) => {
  await act(async () => {
    handlers.current?.onDragStart({ active: { id: activeId } });
    void handlers.current?.onDragEnd({
      active: { id: activeId },
      over: overId === null ? null : { id: overId },
    });
  });
};

beforeEach(() => {
  vi.resetAllMocks();
  handlers.current = null;
});

describe("dragging a card", () => {
  it("moves it to another column at the dropped slot", async () => {
    const board = buildBoard();
    await renderBoard(board);
    vi.mocked(api.moveCard).mockResolvedValue(board);

    await drag(cardDragId(101), columnDragId(2));

    await waitFor(() => expect(api.moveCard).toHaveBeenCalledWith(101, 2, 1));
  });

  it("drops onto an empty column at slot zero", async () => {
    const board = buildBoard();
    await renderBoard(board);
    vi.mocked(api.moveCard).mockResolvedValue(board);

    await drag(cardDragId(101), columnDragId(3));

    await waitFor(() => expect(api.moveCard).toHaveBeenCalledWith(101, 3, 0));
  });

  it("reorders within a column using the slot with the card removed", async () => {
    const board = buildBoard();
    await renderBoard(board);
    vi.mocked(api.moveCard).mockResolvedValue(board);

    await drag(cardDragId(103), cardDragId(101));

    await waitFor(() => expect(api.moveCard).toHaveBeenCalledWith(103, 1, 0));
  });

  it("shows the move before the server confirms it", async () => {
    await renderBoard();
    vi.mocked(api.moveCard).mockReturnValue(new Promise(() => {}));

    await drag(cardDragId(101), columnDragId(2));

    // The optimistic board already shows the card in its new column.
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Column In Progress" })
      ).toHaveTextContent("A")
    );
  });

  it("ignores a drop that changes nothing", async () => {
    await renderBoard();
    await drag(cardDragId(101), cardDragId(101));
    expect(api.moveCard).not.toHaveBeenCalled();
  });

  it("ignores a drop outside any target", async () => {
    await renderBoard();
    await drag(cardDragId(101), null);
    expect(api.moveCard).not.toHaveBeenCalled();
  });

  it("ignores a drag id it does not recognise", async () => {
    await renderBoard();
    await drag("widget:1", columnDragId(2));
    expect(api.moveCard).not.toHaveBeenCalled();
  });

  it("reports a rejected move and reloads the board", async () => {
    const board = buildBoard();
    await renderBoard(board);
    vi.mocked(api.moveCard).mockRejectedValue(
      new Error("Column In Progress is at its WIP limit")
    );
    vi.mocked(api.fetchBoard).mockResolvedValue(board);

    await drag(cardDragId(101), columnDragId(2));

    expect(await screen.findByRole("alert")).toHaveTextContent("at its WIP limit");
    // The board is refetched so the optimistic move is undone.
    await waitFor(() => expect(api.fetchBoard).toHaveBeenCalledTimes(2));
  });
});
