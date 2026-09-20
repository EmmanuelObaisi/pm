import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoardList } from "@/components/BoardList";
import * as api from "@/lib/api";
import type { BoardSummary } from "@/lib/types";
import { makeBoard } from "@/test/factories";

vi.mock("@/lib/api");

const summary = (overrides: Partial<BoardSummary> = {}): BoardSummary => ({
  ...makeBoard(),
  ...overrides,
  stats: { ...makeBoard().stats, ...(overrides.stats ?? {}) },
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("BoardList", () => {
  it("lists the boards with their counts and owner", async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([
      summary({
        id: 1,
        name: "Roadmap",
        description: "Quarterly plan",
        owner_username: "alice",
        stats: { active_cards: 4, overdue_cards: 1 } as never,
      }),
      summary({ id: 2, name: "Hiring", role: "viewer", owner_username: "bob" }),
    ]);
    render(<BoardList onOpen={vi.fn()} />);

    expect(await screen.findByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Quarterly plan")).toBeInTheDocument();
    expect(screen.getByText("4 cards")).toBeInTheDocument();
    expect(screen.getByText("1 overdue")).toBeInTheDocument();
    expect(screen.getByText("by alice")).toBeInTheDocument();
    expect(screen.getByText("You can view this board")).toBeInTheDocument();
  });

  it("shows a spinner while loading", () => {
    vi.mocked(api.fetchBoards).mockReturnValue(new Promise(() => {}));
    render(<BoardList onOpen={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading boards");
  });

  it("shows an empty state when there are no boards", async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([]);
    render(<BoardList onOpen={vi.fn()} />);
    expect(await screen.findByText("No boards yet")).toBeInTheDocument();
  });

  it("reports a failure to load", async () => {
    vi.mocked(api.fetchBoards).mockRejectedValue(new Error("Not authenticated"));
    render(<BoardList onOpen={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Not authenticated");
  });

  it("opens a board when its name is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchBoards).mockResolvedValue([summary({ id: 7, name: "Roadmap" })]);
    const onOpen = vi.fn();
    render(<BoardList onOpen={onOpen} />);

    await user.click(await screen.findByText("Roadmap"));
    expect(onOpen).toHaveBeenCalledWith(7);
  });

  it("creates a board and opens it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchBoards).mockResolvedValue([]);
    vi.mocked(api.createBoard).mockResolvedValue(makeBoard({ id: 12 }));
    const onOpen = vi.fn();
    render(<BoardList onOpen={onOpen} />);

    await user.click(await screen.findByRole("button", { name: "New board" }));
    await user.type(screen.getByLabelText("Name"), "Launch plan");
    await user.type(screen.getByLabelText("Description"), "Everything for launch");
    await user.selectOptions(screen.getByLabelText("Template"), "empty");
    await user.click(screen.getByRole("button", { name: "Create board" }));

    expect(api.createBoard).toHaveBeenCalledWith({
      name: "Launch plan",
      description: "Everything for launch",
      template: "empty",
    });
    expect(onOpen).toHaveBeenCalledWith(12);
  });

  it("reports a failed creation", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchBoards).mockResolvedValue([]);
    vi.mocked(api.createBoard).mockRejectedValue(new Error("Name is required"));
    render(<BoardList onOpen={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "New board" }));
    await user.type(screen.getByLabelText("Name"), "x");
    await user.click(screen.getByRole("button", { name: "Create board" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Name is required");
  });

  it("archives and restores a board", async () => {
    const user = userEvent.setup();
    // The list refetches after the update, so queue the archived board next.
    vi.mocked(api.fetchBoards)
      .mockResolvedValueOnce([summary({ id: 3, name: "Roadmap" })])
      .mockResolvedValue([summary({ id: 3, name: "Roadmap", archived: true })]);
    vi.mocked(api.updateBoard).mockResolvedValue(makeBoard());
    render(<BoardList onOpen={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Archive" }));
    expect(api.updateBoard).toHaveBeenCalledWith(3, { archived: true });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument()
    );
  });

  it("deletes a board after confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchBoards).mockResolvedValue([summary({ id: 3, name: "Roadmap" })]);
    vi.mocked(api.deleteBoard).mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BoardList onOpen={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(api.deleteBoard).toHaveBeenCalledWith(3);
  });

  it("keeps a board when the confirmation is declined", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchBoards).mockResolvedValue([summary({ id: 3 })]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<BoardList onOpen={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(api.deleteBoard).not.toHaveBeenCalled();
  });

  it("hides owner-only controls on a shared board", async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([summary({ id: 4, role: "editor" })]);
    render(<BoardList onOpen={vi.fn()} />);

    await screen.findByText("You can edit this board");
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("asks for archived boards when the box is ticked", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchBoards).mockResolvedValue([]);
    render(<BoardList onOpen={vi.fn()} />);

    await screen.findByText("No boards yet");
    await user.click(screen.getByLabelText("Show archived"));

    await waitFor(() => expect(api.fetchBoards).toHaveBeenLastCalledWith(true));
  });
});
