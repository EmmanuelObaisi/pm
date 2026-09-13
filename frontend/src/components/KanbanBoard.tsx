"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { askAI, fetchBoard, saveBoard } from "@/lib/api";
import { createId, initialData, moveCard, type BoardData } from "@/lib/kanban";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

export const KanbanBoard = () => {
  const [board, setBoard] = useState<BoardData>(() => initialData);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "I can help reorganize the board, add tasks, or move work between columns.",
    },
  ]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [boardError, setBoardError] = useState("");
  const skipNextSaveRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const cardsById = useMemo(() => board.cards, [board.cards]);

  useEffect(() => {
    if (!isSignedIn || !username) {
      return;
    }

    let ignore = false;

    const loadBoard = async () => {
      try {
        const nextBoard = await fetchBoard(username);
        if (!ignore) {
          skipNextSaveRef.current = true;
          setBoard(nextBoard);
          setBoardError("");
        }
      } catch {
        if (!ignore) {
          setBoardError("Could not load your board. Showing local data instead.");
        }
      }
    };

    void loadBoard();

    return () => {
      ignore = true;
    };
  }, [isSignedIn, username]);

  useEffect(() => {
    if (!isSignedIn || !username) {
      return;
    }

    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      saveBoard(username, board)
        .then(() => setBoardError(""))
        .catch(() => setBoardError("Could not save your changes. Retrying on the next edit."));
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [board, isSignedIn, username]);

  const handleSignIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (username === "user" && password === "password") {
      setIsSignedIn(true);
      setError("");
      return;
    }

    setError("Invalid username or password.");
  };

  const handleLogout = () => {
    setIsSignedIn(false);
    setUsername("");
    setPassword("");
    setError("");
    setChatInput("");
    setChatMessages([
      {
        role: "assistant",
        text: "I can help reorganize the board, add tasks, or move work between columns.",
      },
    ]);
    setAiError("");
    setBoardError("");
  };

  const handleAskAI = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedPrompt = chatInput.trim();
    if (!trimmedPrompt || !isSignedIn || isAiLoading) {
      return;
    }

    const nextMessages: ChatMessage[] = [
      ...chatMessages,
      { role: "user", text: trimmedPrompt },
    ];
    const conversationHistory = chatMessages
      .filter(
        (message) =>
          !(message.role === "assistant" && message.text === "I can help reorganize the board, add tasks, or move work between columns.")
      )
      .map((message) => ({
        role: message.role,
        content: message.text,
      }));

    setChatMessages(nextMessages);
    setChatInput("");
    setIsAiLoading(true);
    setAiError("");

    try {
      const response = await askAI(
        username,
        board,
        trimmedPrompt,
        conversationHistory
      );

      const assistantReply = response.reply || "I’m not sure how to update the board from that request.";
      setChatMessages((previous) => [
        ...previous,
        { role: "assistant", text: assistantReply },
      ]);

      if (response.board_update) {
        setBoard(response.board_update);
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "The assistant could not complete that request.";
      setAiError(message);
      setChatMessages((previous) => [
        ...previous,
        { role: "assistant", text: "Sorry, I couldn’t process that request." },
      ]);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!over || active.id === over.id) {
      return;
    }

    setBoard((prev) => ({
      ...prev,
      columns: moveCard(prev.columns, active.id as string, over.id as string),
    }));
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    setBoard((prev) => ({
      ...prev,
      columns: prev.columns.map((column) =>
        column.id === columnId ? { ...column, title } : column
      ),
    }));
  };

  const handleEditCard = (
    cardId: string,
    field: "title" | "details",
    value: string
  ) => {
    setBoard((prev) => ({
      ...prev,
      cards: {
        ...prev.cards,
        [cardId]: { ...prev.cards[cardId], [field]: value },
      },
    }));
  };

  const handleAddCard = (columnId: string, title: string, details: string) => {
    const id = createId("card");
    setBoard((prev) => ({
      ...prev,
      cards: {
        ...prev.cards,
        [id]: { id, title, details: details || "No details yet." },
      },
      columns: prev.columns.map((column) =>
        column.id === columnId
          ? { ...column, cardIds: [...column.cardIds, id] }
          : column
      ),
    }));
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    setBoard((prev) => {
      return {
        ...prev,
        cards: Object.fromEntries(
          Object.entries(prev.cards).filter(([id]) => id !== cardId)
        ),
        columns: prev.columns.map((column) =>
          column.id === columnId
            ? {
                ...column,
                cardIds: column.cardIds.filter((id) => id !== cardId),
              }
            : column
        ),
      };
    });
  };

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

  if (!isSignedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--surface)] px-6 py-12">
        <div className="w-full max-w-md rounded-[32px] border border-[var(--stroke)] bg-white p-8 shadow-[var(--shadow)]">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--gray-text)]">
            Project workspace
          </p>
          <h1 className="mt-4 font-display text-3xl font-semibold text-[var(--navy-dark)]">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-[var(--gray-text)]">
            Use the demo credentials to access the board.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSignIn}>
            <div>
              <label htmlFor="username" className="mb-2 block text-sm font-medium text-[var(--navy-dark)]">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-xl border border-[var(--stroke)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary-blue)]"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-[var(--navy-dark)]">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-[var(--stroke)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary-blue)]"
              />
            </div>

            {error ? (
              <p className="text-sm font-medium text-red-600">{error}</p>
            ) : null}

            <button
              type="submit"
              className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-3 text-sm font-semibold uppercase tracking-[0.15em] text-white transition hover:brightness-110"
            >
              Sign in
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12">
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                  Focus
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                  One board. Five columns. Zero clutter.
                </p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
              >
                Log out
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

        {boardError ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-medium text-red-600">
            {boardError}
          </p>
        ) : null}

        <div className="flex flex-col gap-6 xl:flex-row">
          <div className="min-w-0 flex-1">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <section className="grid gap-6 lg:grid-cols-5">
                {board.columns.map((column) => (
                  <KanbanColumn
                    key={column.id}
                    column={column}
                    cards={column.cardIds.map((cardId) => board.cards[cardId])}
                    onRename={handleRenameColumn}
                    onEditCard={handleEditCard}
                    onAddCard={handleAddCard}
                    onDeleteCard={handleDeleteCard}
                  />
                ))}
              </section>
              <DragOverlay>
                {activeCard ? (
                  <div className="w-[260px]">
                    <KanbanCardPreview card={activeCard} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>

          <aside className="w-full xl:w-[360px]">
            <div className="flex h-full flex-col rounded-[28px] border border-[var(--stroke)] bg-white p-4 shadow-[var(--shadow)]">
              <div className="mb-4 flex items-center justify-between gap-2 border-b border-[var(--stroke)] pb-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                    Assistant
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-[var(--navy-dark)]">
                    AI Planner
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setChatOpen((open) => !open)}
                  className="rounded-full border border-[var(--stroke)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
                >
                  {chatOpen ? "Hide" : "Show"}
                </button>
              </div>

              {chatOpen ? (
                <>
                  <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl bg-[var(--surface)] p-3">
                    {chatMessages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-6 ${
                          message.role === "assistant"
                            ? "bg-white text-[var(--navy-dark)]"
                            : "ml-auto bg-[var(--primary-blue)] text-white"
                        }`}
                      >
                        {message.text}
                      </div>
                    ))}
                    {isAiLoading ? (
                      <div className="rounded-2xl bg-white px-3 py-2 text-sm text-[var(--gray-text)]">
                        Thinking…
                      </div>
                    ) : null}
                  </div>

                  {aiError ? (
                    <p className="mt-3 text-sm font-medium text-red-600">{aiError}</p>
                  ) : null}

                  <form onSubmit={handleAskAI} className="mt-4 space-y-3">
                    <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]" htmlFor="ai-question">
                      Question
                    </label>
                    <textarea
                      id="ai-question"
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      rows={4}
                      placeholder="Ask for a change to the board..."
                      className="w-full rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
                    />
                    <button
                      type="submit"
                      disabled={isAiLoading || !chatInput.trim()}
                      className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isAiLoading ? "Sending..." : "Send"}
                    </button>
                  </form>
                </>
              ) : null}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};
