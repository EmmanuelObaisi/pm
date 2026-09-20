import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CardDrawer } from "@/components/CardDrawer";
import * as api from "@/lib/api";
import type { Board, Comment } from "@/lib/types";
import { boardWithCards, makeLabel, makeMember, makeUser } from "@/test/factories";

vi.mock("@/lib/api");

const currentUser = makeUser({ id: 1, username: "alice" });

const buildBoard = (overrides: Partial<Board> = {}): Board =>
  boardWithCards([["Write the spec"], []], {
    labels: [
      makeLabel({ id: 50, name: "Bug", color: "#ef4444" }),
      makeLabel({ id: 51, name: "Feature", color: "#3b82f6" }),
    ],
    members: [
      makeMember({ user_id: 1, username: "alice", role: "owner" }),
      makeMember({ user_id: 2, username: "bob", role: "editor" }),
    ],
    ...overrides,
  });

const comment = (overrides: Partial<Comment> = {}): Comment => ({
  id: 900,
  card_id: 101,
  user_id: 1,
  username: "alice",
  body: "Looks good",
  created_at: "2026-02-01T10:00:00+00:00",
  ...overrides,
});

const renderDrawer = async (
  board: Board = buildBoard(),
  comments: Comment[] = [],
  editable = true
) => {
  vi.mocked(api.fetchComments).mockResolvedValue(comments);
  const onBoardChange = vi.fn();
  const onClose = vi.fn();
  render(
    <CardDrawer
      cardId={101}
      board={board}
      currentUser={currentUser}
      editable={editable}
      onBoardChange={onBoardChange}
      onClose={onClose}
    />
  );
  await screen.findByRole("dialog", { name: "Card Write the spec" });
  return { board, onBoardChange, onClose };
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CardDrawer fields", () => {
  it("shows the card's current values", async () => {
    const board = buildBoard();
    board.cards[0].details = "Cover the API surface";
    board.cards[0].priority = "high";
    board.cards[0].due_date = "2026-05-01";
    board.cards[0].estimate = 4;
    board.cards[0].assignee_id = 2;
    await renderDrawer(board);

    expect(screen.getByLabelText("Title")).toHaveValue("Write the spec");
    expect(screen.getByLabelText("Description")).toHaveValue("Cover the API surface");
    expect(screen.getByLabelText("Priority")).toHaveValue("high");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-05-01");
    expect(screen.getByLabelText("Estimate (hours)")).toHaveValue(4);
    expect(screen.getByLabelText("Assignee")).toHaveValue("2");
  });

  it("saves a changed title on blur", async () => {
    const user = userEvent.setup();
    const { board, onBoardChange } = await renderDrawer();
    vi.mocked(api.updateCard).mockResolvedValue(board);

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Write the RFC");
    await user.tab();

    await waitFor(() =>
      expect(api.updateCard).toHaveBeenCalledWith(101, { title: "Write the RFC" })
    );
    expect(onBoardChange).toHaveBeenCalled();
  });

  it("does not save an unchanged title", async () => {
    const user = userEvent.setup();
    await renderDrawer();
    await user.click(screen.getByLabelText("Title"));
    await user.tab();
    expect(api.updateCard).not.toHaveBeenCalled();
  });

  it("saves the description on blur", async () => {
    const user = userEvent.setup();
    const { board } = await renderDrawer();
    vi.mocked(api.updateCard).mockResolvedValue(board);

    await user.type(screen.getByLabelText("Description"), "New notes");
    await user.tab();

    await waitFor(() =>
      expect(api.updateCard).toHaveBeenCalledWith(101, { details: "New notes" })
    );
  });

  it("changes the priority", async () => {
    const user = userEvent.setup();
    const { board } = await renderDrawer();
    vi.mocked(api.updateCard).mockResolvedValue(board);

    await user.selectOptions(screen.getByLabelText("Priority"), "urgent");
    expect(api.updateCard).toHaveBeenCalledWith(101, { priority: "urgent" });
  });

  it("assigns and unassigns a member", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    board.cards[0].assignee_id = 2;
    await renderDrawer(board);
    vi.mocked(api.updateCard).mockResolvedValue(board);

    await user.selectOptions(screen.getByLabelText("Assignee"), "");
    expect(api.updateCard).toHaveBeenCalledWith(101, { clear_assignee: true });

    await user.selectOptions(screen.getByLabelText("Assignee"), "1");
    expect(api.updateCard).toHaveBeenLastCalledWith(101, { assignee_id: 1 });
  });

  it("sets the due date", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    await renderDrawer(board);
    vi.mocked(api.updateCard).mockResolvedValue(board);

    await user.type(screen.getByLabelText("Due date"), "2026-07-04");
    expect(api.updateCard).toHaveBeenLastCalledWith(101, { due_date: "2026-07-04" });
  });

  it("clears a due date that was already set", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    board.cards[0].due_date = "2026-07-04";
    await renderDrawer(board);
    vi.mocked(api.updateCard).mockResolvedValue(board);

    await user.clear(screen.getByLabelText("Due date"));
    expect(api.updateCard).toHaveBeenLastCalledWith(101, { clear_due_date: true });
  });

  it("sets the estimate", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    await renderDrawer(board);
    vi.mocked(api.updateCard).mockResolvedValue(board);

    await user.type(screen.getByLabelText("Estimate (hours)"), "3");
    expect(api.updateCard).toHaveBeenLastCalledWith(101, { estimate: 3 });
  });

  it("clears an estimate that was already set", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    board.cards[0].estimate = 3;
    await renderDrawer(board);
    vi.mocked(api.updateCard).mockResolvedValue(board);

    await user.clear(screen.getByLabelText("Estimate (hours)"));
    expect(api.updateCard).toHaveBeenLastCalledWith(101, { clear_estimate: true });
  });

  it("reports an error from a failed save", async () => {
    const user = userEvent.setup();
    await renderDrawer();
    vi.mocked(api.updateCard).mockRejectedValue(new Error("Assignee is not a member"));

    await user.selectOptions(screen.getByLabelText("Priority"), "low");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Assignee is not a member"
    );
  });
});

describe("labels", () => {
  it("attaches a label the card does not have", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    await renderDrawer(board);
    vi.mocked(api.updateCard).mockResolvedValue(board);

    await user.click(screen.getByRole("button", { name: "Bug" }));
    expect(api.updateCard).toHaveBeenCalledWith(101, { label_ids: [50] });
  });

  it("detaches a label the card already has", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    board.cards[0].label_ids = [50, 51];
    await renderDrawer(board);
    vi.mocked(api.updateCard).mockResolvedValue(board);

    await user.click(screen.getByRole("button", { name: "Bug" }));
    expect(api.updateCard).toHaveBeenCalledWith(101, { label_ids: [51] });
  });

  it("marks attached labels as pressed", async () => {
    const board = buildBoard();
    board.cards[0].label_ids = [51];
    await renderDrawer(board);

    expect(screen.getByRole("button", { name: "Bug" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "Feature" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("says so when the board has no labels", async () => {
    await renderDrawer(buildBoard({ labels: [] }));
    expect(screen.getByText("No labels on this board.")).toBeInTheDocument();
  });
});

describe("checklist", () => {
  it("adds an item", async () => {
    const user = userEvent.setup();
    const { board } = await renderDrawer();
    vi.mocked(api.addChecklistItem).mockResolvedValue(board);

    await user.type(screen.getByLabelText("New checklist item"), "Draft the outline");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(api.addChecklistItem).toHaveBeenCalledWith(101, "Draft the outline");
  });

  it("ticks an item and shows progress", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    board.cards[0].checklist = [
      { id: 300, text: "Draft", done: false, position: 0 },
      { id: 301, text: "Review", done: true, position: 1 },
    ];
    board.cards[0].checklist_total = 2;
    board.cards[0].checklist_done = 1;
    await renderDrawer(board);
    vi.mocked(api.updateChecklistItem).mockResolvedValue(board);

    expect(screen.getByText("Checklist (1/2)")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Draft"));
    expect(api.updateChecklistItem).toHaveBeenCalledWith(300, { done: true });
  });

  it("removes an item", async () => {
    const user = userEvent.setup();
    const board = buildBoard();
    board.cards[0].checklist = [{ id: 300, text: "Draft", done: false, position: 0 }];
    await renderDrawer(board);
    vi.mocked(api.deleteChecklistItem).mockResolvedValue(board);

    await user.click(screen.getByRole("button", { name: "Remove Draft" }));
    expect(api.deleteChecklistItem).toHaveBeenCalledWith(300);
  });
});

describe("comments", () => {
  it("lists existing comments", async () => {
    await renderDrawer(buildBoard(), [
      comment({ id: 900, body: "Looks good", username: "alice" }),
      comment({ id: 901, body: "Shipping today", username: "bob", user_id: 2 }),
    ]);

    expect(screen.getByText("Looks good")).toBeInTheDocument();
    expect(screen.getByText("Shipping today")).toBeInTheDocument();
  });

  it("says so when there are none", async () => {
    await renderDrawer();
    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
  });

  it("posts a comment and refreshes the board", async () => {
    const user = userEvent.setup();
    const { board, onBoardChange } = await renderDrawer();
    vi.mocked(api.addComment).mockResolvedValue([comment({ body: "Nice" })]);
    vi.mocked(api.fetchBoard).mockResolvedValue(board);

    await user.type(screen.getByLabelText("New comment"), "Nice");
    await user.click(screen.getByRole("button", { name: "Post" }));

    expect(api.addComment).toHaveBeenCalledWith(101, "Nice");
    await waitFor(() => expect(onBoardChange).toHaveBeenCalled());
  });

  it("does not post an empty comment", async () => {
    const user = userEvent.setup();
    await renderDrawer();
    await user.click(screen.getByRole("button", { name: "Post" }));
    expect(api.addComment).not.toHaveBeenCalled();
  });

  it("lets the owner delete anyone's comment", async () => {
    const user = userEvent.setup();
    const { board } = await renderDrawer(buildBoard(), [
      comment({ id: 901, username: "bob", user_id: 2, body: "Bob's note" }),
    ]);
    vi.mocked(api.deleteComment).mockResolvedValue([]);
    vi.mocked(api.fetchBoard).mockResolvedValue(board);

    await user.click(screen.getByRole("button", { name: "Delete comment by bob" }));
    expect(api.deleteComment).toHaveBeenCalledWith(901);
  });

  it("hides the delete control on another user's comment for an editor", async () => {
    await renderDrawer(buildBoard({ role: "editor" }), [
      comment({ id: 901, username: "bob", user_id: 2 }),
    ]);
    expect(
      screen.queryByRole("button", { name: "Delete comment by bob" })
    ).not.toBeInTheDocument();
  });

  it("still lets an editor delete their own comment", async () => {
    await renderDrawer(buildBoard({ role: "editor" }), [
      comment({ id: 900, username: "alice", user_id: 1 }),
    ]);
    expect(
      screen.getByRole("button", { name: "Delete comment by alice" })
    ).toBeInTheDocument();
  });
});

describe("archiving and deleting", () => {
  it("archives the card", async () => {
    const user = userEvent.setup();
    const { board } = await renderDrawer();
    vi.mocked(api.updateCard).mockResolvedValue(board);

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(api.updateCard).toHaveBeenCalledWith(101, { archived: true });
  });

  it("deletes the card after confirmation", async () => {
    const user = userEvent.setup();
    const { board } = await renderDrawer();
    vi.mocked(api.deleteCard).mockResolvedValue(board);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteCard).toHaveBeenCalledWith(101);
  });

  it("keeps the card when the confirmation is declined", async () => {
    const user = userEvent.setup();
    await renderDrawer();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteCard).not.toHaveBeenCalled();
  });

  it("closes itself when the card is no longer on the board", async () => {
    vi.mocked(api.fetchComments).mockResolvedValue([]);
    const onClose = vi.fn();
    render(
      <CardDrawer
        cardId={999}
        board={buildBoard()}
        currentUser={currentUser}
        editable
        onBoardChange={vi.fn()}
        onClose={onClose}
      />
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("closes on the close button", async () => {
    const user = userEvent.setup();
    const { onClose } = await renderDrawer();
    const dialog = screen.getByRole("dialog", { name: "Card Write the spec" });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("viewer restrictions", () => {
  it("disables the fields and hides every write control", async () => {
    await renderDrawer(buildBoard({ role: "viewer" }), [comment()], false);

    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeDisabled();
    expect(screen.getByLabelText("Priority")).toBeDisabled();
    expect(screen.queryByLabelText("New comment")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New checklist item")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});
