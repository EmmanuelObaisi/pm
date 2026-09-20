import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoardView } from "@/components/BoardView";
import * as api from "@/lib/api";
import type { Board } from "@/lib/types";
import { boardWithCards, makeLabel, makeMember, makeUser } from "@/test/factories";

vi.mock("@/lib/api");

const currentUser = makeUser({ id: 1, username: "alice" });

const buildBoard = (overrides: Partial<Board> = {}): Board =>
  boardWithCards([["Write the spec", "Draft the plan"], ["Build it"], []], {
    labels: [makeLabel({ id: 50, name: "Bug", color: "#ef4444" })],
    members: [makeMember({ user_id: 1, username: "alice", role: "owner" })],
    ...overrides,
  });

const renderBoard = async (board: Board) => {
  vi.mocked(api.fetchBoard).mockResolvedValue(board);
  vi.mocked(api.fetchComments).mockResolvedValue([]);
  vi.mocked(api.fetchAIMessages).mockResolvedValue([]);
  vi.mocked(api.fetchActivity).mockResolvedValue([]);
  const onBack = vi.fn();
  render(<BoardView boardId={board.id} currentUser={currentUser} onBack={onBack} />);
  await screen.findByText("Write the spec");
  return { onBack };
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("BoardView rendering", () => {
  it("shows the board name, role, and its columns and cards", async () => {
    await renderBoard(buildBoard());

    expect(screen.getByRole("heading", { name: "Roadmap" })).toBeInTheDocument();
    expect(screen.getByText(/you are owner/)).toBeInTheDocument();

    const backlog = screen.getByRole("region", { name: "Column Backlog" });
    expect(within(backlog).getByText("Write the spec")).toBeInTheDocument();
    expect(within(backlog).getByText("Draft the plan")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Column In Progress" })).getByText(
        "Build it"
      )
    ).toBeInTheDocument();
  });

  it("shows a loading state before the board arrives", () => {
    vi.mocked(api.fetchBoard).mockReturnValue(new Promise(() => {}));
    render(<BoardView boardId={1} currentUser={currentUser} onBack={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading board");
  });

  it("offers a way back when the board cannot be loaded", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchBoard).mockRejectedValue(new Error("Board not found"));
    const onBack = vi.fn();
    render(<BoardView boardId={9} currentUser={currentUser} onBack={onBack} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Board not found");
    await user.click(screen.getByRole("button", { name: "Back to boards" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("goes back to the board list", async () => {
    const user = userEvent.setup();
    const { onBack } = await renderBoard(buildBoard());
    await user.click(screen.getByRole("button", { name: "Boards" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("shows a column's card count and WIP limit", async () => {
    const board = buildBoard();
    board.columns[0].wip_limit = 3;
    await renderBoard(board);
    expect(
      within(screen.getByRole("region", { name: "Column Backlog" })).getByText("2/3")
    ).toBeInTheDocument();
  });

  it("warns when a column is over its WIP limit", async () => {
    const board = buildBoard();
    board.columns[0].wip_limit = 1;
    await renderBoard(board);
    expect(screen.getByText("Over the WIP limit")).toBeInTheDocument();
  });
});

describe("cards", () => {
  it("adds a card to a column", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    await renderBoard(board);
    vi.mocked(api.createCard).mockResolvedValue(board);

    const backlog = screen.getByRole("region", { name: "Column Backlog" });
    await user.click(within(backlog).getByRole("button", { name: "Add card" }));
    await user.type(
      screen.getByLabelText("New card in Backlog"),
      "Review the design"
    );
    await user.click(within(backlog).getByRole("button", { name: "Add" }));

    expect(api.createCard).toHaveBeenCalledWith(1, {
      column_id: 1,
      title: "Review the design",
    });
  });

  it("does not submit an empty card title", async () => {
    const user = userEvent.setup();
    await renderBoard(buildBoard());

    const backlog = screen.getByRole("region", { name: "Column Backlog" });
    await user.click(within(backlog).getByRole("button", { name: "Add card" }));
    await user.click(within(backlog).getByRole("button", { name: "Add" }));

    expect(api.createCard).not.toHaveBeenCalled();
  });

  it("reports an error from a failed card creation", async () => {
    const user = userEvent.setup();
    await renderBoard(buildBoard());
    vi.mocked(api.createCard).mockRejectedValue(new Error("Column not found"));

    const backlog = screen.getByRole("region", { name: "Column Backlog" });
    await user.click(within(backlog).getByRole("button", { name: "Add card" }));
    await user.type(screen.getByLabelText("New card in Backlog"), "Task");
    await user.click(within(backlog).getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Column not found");
  });

  it("opens the card drawer", async () => {
    const user = userEvent.setup();
    await renderBoard(buildBoard());

    await user.click(screen.getByRole("button", { name: "Open card Write the spec" }));
    expect(
      await screen.findByRole("dialog", { name: "Card Write the spec" })
    ).toBeInTheDocument();
  });
});

describe("columns", () => {
  it("adds a column", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    await renderBoard(board);
    vi.mocked(api.createColumn).mockResolvedValue(board);

    await user.click(screen.getByRole("button", { name: "Add column" }));
    await user.type(screen.getByLabelText("New column title"), "Blocked");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(api.createColumn).toHaveBeenCalledWith(1, "Blocked");
  });

  it("renames a column on blur", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    await renderBoard(board);
    vi.mocked(api.updateColumn).mockResolvedValue(board);

    await user.click(screen.getByRole("button", { name: "Backlog" }));
    const input = screen.getByLabelText("Rename column Backlog");
    await user.clear(input);
    await user.type(input, "Inbox");
    await user.tab();

    await waitFor(() =>
      expect(api.updateColumn).toHaveBeenCalledWith(1, { title: "Inbox" })
    );
  });

  it("does not rename a column to the same title", async () => {
    const user = userEvent.setup();
    await renderBoard(buildBoard());

    await user.click(screen.getByRole("button", { name: "Backlog" }));
    await user.tab();

    expect(api.updateColumn).not.toHaveBeenCalled();
  });

  it("deletes a column after confirmation", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    await renderBoard(board);
    vi.mocked(api.deleteColumn).mockResolvedValue(board);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await user.click(screen.getByRole("button", { name: "Delete column Backlog" }));
    expect(api.deleteColumn).toHaveBeenCalledWith(1);
  });

  it("keeps a column when the confirmation is declined", async () => {
    const user = userEvent.setup();
    await renderBoard(buildBoard());
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await user.click(screen.getByRole("button", { name: "Delete column Backlog" }));
    expect(api.deleteColumn).not.toHaveBeenCalled();
  });

  it("sets and clears a WIP limit", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    await renderBoard(board);
    vi.mocked(api.updateColumn).mockResolvedValue(board);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("4");

    await user.click(screen.getByRole("button", { name: "Set WIP limit for Backlog" }));
    expect(api.updateColumn).toHaveBeenCalledWith(1, {
      wip_limit: 4,
      clear_wip_limit: false,
    });

    prompt.mockReturnValue("");
    await user.click(screen.getByRole("button", { name: "Set WIP limit for Backlog" }));
    expect(api.updateColumn).toHaveBeenLastCalledWith(1, {
      wip_limit: null,
      clear_wip_limit: true,
    });
  });

  it("ignores a cancelled or invalid WIP limit", async () => {
    const user = userEvent.setup();
    await renderBoard(buildBoard());
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);

    await user.click(screen.getByRole("button", { name: "Set WIP limit for Backlog" }));
    prompt.mockReturnValue("not a number");
    await user.click(screen.getByRole("button", { name: "Set WIP limit for Backlog" }));
    prompt.mockReturnValue("-2");
    await user.click(screen.getByRole("button", { name: "Set WIP limit for Backlog" }));

    expect(api.updateColumn).not.toHaveBeenCalled();
  });
});

describe("filters", () => {
  it("narrows the board by search text", async () => {
    const user = userEvent.setup();
    await renderBoard(buildBoard());

    await user.type(screen.getByLabelText("Search cards"), "spec");

    expect(screen.getByText("Write the spec")).toBeInTheDocument();
    expect(screen.queryByText("Draft the plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Build it")).not.toBeInTheDocument();
  });

  it("filters by priority", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    board.cards[0].priority = "urgent";
    await renderBoard(board);

    await user.selectOptions(screen.getByLabelText("Filter by priority"), "urgent");

    expect(screen.getByText("Write the spec")).toBeInTheDocument();
    expect(screen.queryByText("Draft the plan")).not.toBeInTheDocument();
  });

  it("filters by assignee", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    board.cards[1].assignee_id = 1;
    await renderBoard(board);

    await user.selectOptions(screen.getByLabelText("Filter by assignee"), "1");

    expect(screen.getByText("Draft the plan")).toBeInTheDocument();
    expect(screen.queryByText("Write the spec")).not.toBeInTheDocument();
  });

  it("filters by label", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    board.cards[2].label_ids = [50];
    await renderBoard(board);

    await user.selectOptions(screen.getByLabelText("Filter by label"), "50");

    expect(screen.getByText("Build it")).toBeInTheDocument();
    expect(screen.queryByText("Write the spec")).not.toBeInTheDocument();
  });

  it("clears every filter", async () => {
    const user = userEvent.setup();
    await renderBoard(buildBoard());

    await user.type(screen.getByLabelText("Search cards"), "spec");
    expect(screen.queryByText("Build it")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Build it")).toBeInTheDocument();
  });
});

describe("role restrictions", () => {
  it("hides every editing control from a viewer", async () => {
    await renderBoard(buildBoard({ role: "viewer" }));

    expect(screen.queryByRole("button", { name: "Add card" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add column" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete column Backlog" })
    ).not.toBeInTheDocument();
  });

  it("lets an editor add cards but not manage members", async () => {
    const user = userEvent.setup();
    await renderBoard(buildBoard({ role: "editor" }));

    expect(screen.getAllByRole("button", { name: "Add card" }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.click(screen.getByRole("button", { name: "Members" }));
    expect(screen.queryByLabelText("Username to add")).not.toBeInTheDocument();
  });
});

describe("side panels", () => {
  it("toggles the details sidebar", async () => {
    const user = userEvent.setup();
    await renderBoard(buildBoard());

    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("complementary", { name: "Board details" })).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("complementary", { name: "Board details" })).getByRole(
        "button",
        { name: "Close" }
      )
    );
    expect(
      screen.queryByRole("complementary", { name: "Board details" })
    ).not.toBeInTheDocument();
  });

  it("toggles the assistant panel", async () => {
    const user = userEvent.setup();
    await renderBoard(buildBoard());

    await user.click(screen.getByRole("button", { name: "Assistant" }));
    expect(screen.getByRole("complementary", { name: "AI assistant" })).toBeInTheDocument();
  });
});
