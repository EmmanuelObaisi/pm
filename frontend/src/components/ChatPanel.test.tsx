import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "@/components/ChatPanel";
import * as api from "@/lib/api";
import type { AIMessage, Board } from "@/lib/types";
import { boardWithCards } from "@/test/factories";

vi.mock("@/lib/api");

const board = () => boardWithCards([["Write the spec"], []]);

const message = (id: number, role: "user" | "assistant", content: string): AIMessage => ({
  id,
  role,
  content,
  created_at: "2026-02-01T10:00:00+00:00",
});

const renderPanel = async (
  history: AIMessage[] = [],
  editable = true,
  current: Board = board()
) => {
  vi.mocked(api.fetchAIMessages).mockResolvedValue(history);
  const onBoardChange = vi.fn();
  const onClose = vi.fn();
  render(
    <ChatPanel
      board={current}
      editable={editable}
      onBoardChange={onBoardChange}
      onClose={onClose}
    />
  );
  await waitFor(() => expect(api.fetchAIMessages).toHaveBeenCalledWith(1));
  return { onBoardChange, onClose };
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ChatPanel", () => {
  it("shows a hint when there is no conversation yet", async () => {
    await renderPanel();
    expect(await screen.findByText(/Ask about this board/)).toBeInTheDocument();
  });

  it("replays the stored conversation", async () => {
    await renderPanel([
      message(1, "user", "What is overdue?"),
      message(2, "assistant", "Nothing is overdue."),
    ]);

    expect(await screen.findByText("What is overdue?")).toBeInTheDocument();
    expect(screen.getByText("Nothing is overdue.")).toBeInTheDocument();
  });

  it("sends a question and applies the returned board", async () => {
    const user = userEvent.setup();
    const updated = board();
    const { onBoardChange } = await renderPanel();

    vi.mocked(api.askAI).mockResolvedValue({
      reply: "Added it.",
      applied: ["created card Ship the API"],
      errors: [],
      board: updated,
    });
    vi.mocked(api.fetchAIMessages).mockResolvedValue([
      message(1, "user", "Add a card"),
      message(2, "assistant", "Added it."),
    ]);

    await user.type(screen.getByLabelText("Message the assistant"), "Add a card");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(api.askAI).toHaveBeenCalledWith(1, "Add a card");
    await waitFor(() => expect(onBoardChange).toHaveBeenCalledWith(updated));
    expect(await screen.findByText("created card Ship the API")).toBeInTheDocument();
  });

  it("shows the question straight away while waiting", async () => {
    const user = userEvent.setup();
    await renderPanel();
    vi.mocked(api.askAI).mockReturnValue(new Promise(() => {}));

    await user.type(screen.getByLabelText("Message the assistant"), "Slow question");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("Slow question")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Thinking");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("reports operations the assistant could not apply", async () => {
    const user = userEvent.setup();
    await renderPanel();
    vi.mocked(api.askAI).mockResolvedValue({
      reply: "Partly done.",
      applied: [],
      errors: ["card 42 is not on this board"],
      board: board(),
    });
    vi.mocked(api.fetchAIMessages).mockResolvedValue([]);

    await user.type(screen.getByLabelText("Message the assistant"), "Delete card 42");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "card 42 is not on this board"
    );
  });

  it("reports a failed request", async () => {
    const user = userEvent.setup();
    await renderPanel();
    vi.mocked(api.askAI).mockRejectedValue(new Error("OpenRouter request failed"));
    vi.mocked(api.fetchAIMessages).mockResolvedValue([]);

    await user.type(screen.getByLabelText("Message the assistant"), "Hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "OpenRouter request failed"
    );
  });

  it("does not send an empty question", async () => {
    const user = userEvent.setup();
    await renderPanel();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(api.askAI).not.toHaveBeenCalled();
  });

  it("clears the conversation", async () => {
    const user = userEvent.setup();
    await renderPanel([message(1, "user", "Old question")]);
    vi.mocked(api.clearAIMessages).mockResolvedValue(undefined);

    await screen.findByText("Old question");
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(api.clearAIMessages).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(screen.queryByText("Old question")).not.toBeInTheDocument()
    );
  });

  it("reports a failed clear", async () => {
    const user = userEvent.setup();
    await renderPanel();
    vi.mocked(api.clearAIMessages).mockRejectedValue(new Error("Requires editor access"));

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Requires editor access");
  });

  it("closes on the close button", async () => {
    const user = userEvent.setup();
    const { onClose } = await renderPanel();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("lets a viewer read but not send", async () => {
    await renderPanel([message(1, "assistant", "Nothing is overdue.")], false);

    expect(await screen.findByText("Nothing is overdue.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message the assistant")).not.toBeInTheDocument();
    expect(screen.getByText(/Viewers can read the conversation/)).toBeInTheDocument();
  });

  it("still renders when the history cannot be loaded", async () => {
    vi.mocked(api.fetchAIMessages).mockRejectedValue(new Error("nope"));
    render(
      <ChatPanel
        board={board()}
        editable
        onBoardChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText(/Ask about this board/)).toBeInTheDocument();
  });
});
