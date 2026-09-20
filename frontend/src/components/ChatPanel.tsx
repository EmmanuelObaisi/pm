"use client";

import { useEffect, useRef, useState } from "react";

import * as api from "@/lib/api";
import type { AIMessage, Board } from "@/lib/types";
import { Button, ErrorText, Input, Spinner } from "@/components/ui";

export const ChatPanel = ({
  board,
  editable,
  onBoardChange,
  onClose,
}: {
  board: Board;
  editable: boolean;
  onBoardChange: (board: Board) => void;
  onClose: () => void;
}) => {
  const [messages, setMessages] = useState<AIMessage[] | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .fetchAIMessages(board.id)
      .then((loaded) => !cancelled && setMessages(loaded))
      .catch(() => !cancelled && setMessages([]));
    return () => {
      cancelled = true;
    };
  }, [board.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) {
      return;
    }

    setBusy(true);
    setError("");
    setApplied([]);
    // Show the question straight away; the server persists the real record.
    setMessages([
      ...(messages ?? []),
      { id: -Date.now(), role: "user", content: text, created_at: "" },
    ]);
    setQuestion("");

    try {
      const result = await api.askAI(board.id, text);
      setMessages(await api.fetchAIMessages(board.id));
      onBoardChange(result.board);
      setApplied(result.applied);
      if (result.errors.length > 0) {
        setError(`The assistant could not do everything: ${result.errors.join("; ")}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The assistant is unavailable");
      setMessages(await api.fetchAIMessages(board.id).catch(() => messages ?? []));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      await api.clearAIMessages(board.id);
      setMessages([]);
      setApplied([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear the history");
    }
  };

  return (
    <aside
      aria-label="AI assistant"
      className="flex w-96 shrink-0 flex-col border-l border-[var(--stroke)] bg-white"
    >
      <header className="flex items-center justify-between border-b border-[var(--stroke)] px-4 py-3">
        <h2 className="font-display text-sm font-semibold">Assistant</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </header>

      <div className="scroll-slim flex-1 overflow-y-auto px-4 py-3">
        {messages === null ? (
          <Spinner label="Loading conversation" />
        ) : messages.length === 0 ? (
          <p className="text-sm text-[var(--gray-text)]">
            Ask about this board, or tell the assistant to change it. It can create,
            update, move, and comment on cards.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((message) => (
              <li
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-6 rounded-xl bg-[var(--primary-blue)] px-3 py-2 text-sm text-white"
                    : "mr-6 rounded-xl bg-[var(--surface)] px-3 py-2 text-sm"
                }
              >
                <span className="sr-only">
                  {message.role === "user" ? "You said" : "Assistant said"}
                </span>
                {message.content}
              </li>
            ))}
          </ul>
        )}

        {busy ? (
          <div className="mt-3">
            <Spinner label="Thinking" />
          </div>
        ) : null}

        {applied.length > 0 ? (
          <ul className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
            {applied.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        ) : null}

        <div ref={endRef} />
      </div>

      <div className="border-t border-[var(--stroke)] px-4 py-3">
        <ErrorText>{error}</ErrorText>
        {editable ? (
          <form onSubmit={ask} className="mt-2 flex gap-2">
            <Input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask or instruct"
              aria-label="Message the assistant"
              disabled={busy}
            />
            <Button type="submit" size="sm" disabled={busy}>
              Send
            </Button>
          </form>
        ) : (
          <p className="text-xs text-[var(--gray-text)]">
            Viewers can read the conversation but not send messages.
          </p>
        )}
      </div>
    </aside>
  );
};
