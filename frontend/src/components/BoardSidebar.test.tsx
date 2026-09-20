import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSidebar } from "@/components/BoardSidebar";
import * as api from "@/lib/api";
import type { ActivityEntry, Board } from "@/lib/types";
import { boardWithCards, makeLabel, makeMember } from "@/test/factories";

vi.mock("@/lib/api");

const buildBoard = (overrides: Partial<Board> = {}): Board => {
  const board = boardWithCards([["Write the spec", "Draft the plan"], ["Build it"]], {
    labels: [makeLabel({ id: 50, name: "Bug", color: "#ef4444" })],
    members: [
      makeMember({ user_id: 1, username: "alice", role: "owner" }),
      makeMember({ user_id: 2, username: "bob", full_name: "Bob Builder", role: "editor" }),
    ],
    ...overrides,
  });
  board.stats = {
    total_cards: 3,
    active_cards: 3,
    archived_cards: 0,
    overdue_cards: 1,
    total_estimate: 7.5,
    cards_by_column: { "1": 2, "2": 1 },
    cards_by_priority: { medium: 3 },
    cards_by_assignee: { unassigned: 2, bob: 1 },
    ...(overrides.stats ?? {}),
  };
  return board;
};

const renderSidebar = (board = buildBoard(), canManage = true) => {
  const onBoardChange = vi.fn();
  const onClose = vi.fn();
  render(
    <BoardSidebar
      board={board}
      canManage={canManage}
      onBoardChange={onBoardChange}
      onClose={onClose}
    />
  );
  return { board, onBoardChange, onClose };
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("stats tab", () => {
  it("summarizes the board", () => {
    renderSidebar();
    expect(screen.getByText("Active cards").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Overdue").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Estimated hours").nextSibling).toHaveTextContent("7.5");
  });

  it("breaks cards down by column name and assignee", () => {
    renderSidebar();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("unassigned")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
  });

  it("falls back for a column that is no longer on the board", () => {
    const board = buildBoard();
    board.stats.cards_by_column = { "999": 4 };
    renderSidebar(board);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});

describe("members tab", () => {
  const openMembers = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Members" }));
    return user;
  };

  it("lists members with their roles", async () => {
    renderSidebar();
    await openMembers();

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();
    expect(screen.getByLabelText("Role for bob")).toHaveValue("editor");
    // The owner's role is fixed, so it is shown as a badge.
    expect(screen.queryByLabelText("Role for alice")).not.toBeInTheDocument();
  });

  it("adds a member", async () => {
    renderSidebar();
    const user = await openMembers();
    vi.mocked(api.addMember).mockResolvedValue([
      makeMember({ user_id: 3, username: "carol", role: "viewer" }),
    ]);

    await user.type(screen.getByLabelText("Username to add"), "carol");
    await user.selectOptions(screen.getByLabelText("Role for the new member"), "viewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(api.addMember).toHaveBeenCalledWith(1, "carol", "viewer");
    expect(await screen.findByText("carol")).toBeInTheDocument();
  });

  it("reports a failed add", async () => {
    renderSidebar();
    const user = await openMembers();
    vi.mocked(api.addMember).mockRejectedValue(new Error("User not found"));

    await user.type(screen.getByLabelText("Username to add"), "ghost");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("User not found");
  });

  it("does not add an empty username", async () => {
    renderSidebar();
    const user = await openMembers();
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(api.addMember).not.toHaveBeenCalled();
  });

  it("changes a member's role", async () => {
    renderSidebar();
    const user = await openMembers();
    vi.mocked(api.updateMember).mockResolvedValue([]);

    await user.selectOptions(screen.getByLabelText("Role for bob"), "viewer");
    expect(api.updateMember).toHaveBeenCalledWith(1, 2, "viewer");
  });

  it("removes a member", async () => {
    renderSidebar();
    const user = await openMembers();
    vi.mocked(api.removeMember).mockResolvedValue([
      makeMember({ user_id: 1, username: "alice", role: "owner" }),
    ]);

    await user.click(screen.getByRole("button", { name: "Remove bob" }));
    expect(api.removeMember).toHaveBeenCalledWith(1, 2);
    await waitFor(() => expect(screen.queryByText("Bob Builder")).not.toBeInTheDocument());
  });

  it("shows read-only roles when the viewer cannot manage members", async () => {
    renderSidebar(buildBoard(), false);
    await openMembers();

    expect(screen.queryByLabelText("Role for bob")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Username to add")).not.toBeInTheDocument();
    expect(screen.getByText("editor")).toBeInTheDocument();
  });
});

describe("labels tab", () => {
  const openLabels = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Labels" }));
    return user;
  };

  it("creates a label", async () => {
    const { board, onBoardChange } = renderSidebar();
    const user = await openLabels();
    vi.mocked(api.createLabel).mockResolvedValue(board);

    await user.type(screen.getByLabelText("New label name"), "Blocked");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(api.createLabel).toHaveBeenCalledWith(1, "Blocked", "#64748b");
    await waitFor(() => expect(onBoardChange).toHaveBeenCalledWith(board));
  });

  it("deletes a label", async () => {
    const { board } = renderSidebar();
    const user = await openLabels();
    vi.mocked(api.deleteLabel).mockResolvedValue(board);

    await user.click(screen.getByRole("button", { name: "Delete label Bug" }));
    expect(api.deleteLabel).toHaveBeenCalledWith(1, 50);
  });

  it("reports a failed delete", async () => {
    renderSidebar();
    const user = await openLabels();
    vi.mocked(api.deleteLabel).mockRejectedValue(new Error("Requires editor access"));

    await user.click(screen.getByRole("button", { name: "Delete label Bug" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Requires editor access");
  });

  it("does not create a label with no name", async () => {
    renderSidebar();
    const user = await openLabels();
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(api.createLabel).not.toHaveBeenCalled();
  });
});

describe("activity tab", () => {
  const entry = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
    id: 1,
    action: "card.create",
    summary: "created card Write the spec",
    username: "alice",
    created_at: "2026-02-01T10:00:00+00:00",
    ...overrides,
  });

  it("loads the feed when the tab is opened", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchActivity).mockResolvedValue([entry()]);
    renderSidebar();

    expect(api.fetchActivity).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Activity" }));

    expect(await screen.findByText("created card Write the spec")).toBeInTheDocument();
    expect(api.fetchActivity).toHaveBeenCalledWith(1);
  });

  it("says so when nothing has happened", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchActivity).mockResolvedValue([]);
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Activity" }));
    expect(await screen.findByText("Nothing has happened yet.")).toBeInTheDocument();
  });

  it("recovers when the feed cannot be loaded", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchActivity).mockRejectedValue(new Error("nope"));
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Activity" }));
    expect(await screen.findByText("Nothing has happened yet.")).toBeInTheDocument();
  });
});

describe("closing", () => {
  it("closes on the close button", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSidebar();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
