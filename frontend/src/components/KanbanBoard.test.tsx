import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { KanbanBoard } from "@/components/KanbanBoard";
import { askAI, fetchBoard, saveBoard } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  askAI: vi.fn(),
  fetchBoard: vi.fn(),
  saveBoard: vi.fn(),
}));

const mockedAskAI = vi.mocked(askAI);
const mockedFetchBoard = vi.mocked(fetchBoard);
const mockedSaveBoard = vi.mocked(saveBoard);

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];

const mockBoard = {
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1"] },
    { id: "col-done", title: "Done", cardIds: [] },
  ],
  cards: {
    "card-1": { id: "card-1", title: "Board from API", details: "Stored remotely" },
  },
};

describe("KanbanBoard", () => {
  beforeEach(() => {
    mockedFetchBoard.mockResolvedValue(mockBoard);
    mockedSaveBoard.mockImplementation(async (_user, board) => board);
  });

  it("requires sign in before showing the board", async () => {
    render(<KanbanBoard />);

    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryAllByTestId(/column-/i)).toHaveLength(0);

    await userEvent.type(screen.getByLabelText(/username/i), "user");
    await userEvent.type(screen.getByLabelText(/password/i), "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByRole("heading", { name: /kanban studio/i })).toBeInTheDocument();
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(2);
  });

  it("loads the board from the backend after sign in", async () => {
    render(<KanbanBoard />);

    await userEvent.type(screen.getByLabelText(/username/i), "user");
    await userEvent.type(screen.getByLabelText(/password/i), "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(mockedFetchBoard).toHaveBeenCalledWith("user");
    expect(screen.getByText("Board from API")).toBeInTheDocument();
  });

  it("saves changes back to the backend", async () => {
    render(<KanbanBoard />);

    await userEvent.type(screen.getByLabelText(/username/i), "user");
    await userEvent.type(screen.getByLabelText(/password/i), "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const column = getFirstColumn();
    const input = within(column).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "Updated Backlog");

    await waitFor(() => {
      expect(mockedSaveBoard).toHaveBeenCalled();
    });
  });

  it("sends the board to the AI assistant and applies board updates", async () => {
    mockedAskAI.mockResolvedValue({
      reply: "Added a card to the review column.",
      board_update: {
        columns: [
          { id: "col-backlog", title: "Backlog", cardIds: [] },
          { id: "col-review", title: "Review", cardIds: ["card-2"] },
        ],
        cards: {
          "card-2": { id: "card-2", title: "AI card", details: "Added by assistant" },
        },
      },
    });

    render(<KanbanBoard />);

    await userEvent.type(screen.getByLabelText(/username/i), "user");
    await userEvent.type(screen.getByLabelText(/password/i), "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const questionInput = screen.getByLabelText(/question/i);
    await userEvent.type(questionInput, "Add a card to review");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(mockedAskAI).toHaveBeenCalledWith(
        "user",
        expect.objectContaining({ columns: expect.any(Array) }),
        "Add a card to review",
        []
      );
    });

    expect(await screen.findByText(/Added a card to the review column/i)).toBeInTheDocument();
    expect(screen.getByText("AI card")).toBeInTheDocument();
  });
});
