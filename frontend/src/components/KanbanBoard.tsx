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
import {
  AlertIcon,
  BoardIcon,
  LogoutIcon,
  PanelIcon,
  SendIcon,
  SparkIcon,
} from "@/components/icons";
import { askAI, fetchBoard, saveBoard } from "@/lib/api";
import { columnAccent } from "@/lib/accents";
import { createId, initialData, moveCard, type BoardData } from "@/lib/kanban";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

const GREETING =
  "I can help reorganize the board, add tasks, or move work between columns.";

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
    { role: "assistant", text: GREETING },
  ]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [boardError, setBoardError] = useState("");
  const skipNextSaveRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const cardsById = useMemo(() => board.cards, [board.cards]);
  const totalCards = useMemo(
    () => board.columns.reduce((count, column) => count + column.cardIds.length, 0),
    [board.columns]
  );

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

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [chatMessages, isAiLoading]);

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
    setChatMessages([{ role: "assistant", text: GREETING }]);
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
        (message) => !(message.role === "assistant" && message.text === GREETING)
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
  const activeColumnIndex = activeCardId
    ? board.columns.findIndex((column) => column.cardIds.includes(activeCardId))
    : -1;
  const activeAccent = columnAccent(Math.max(activeColumnIndex, 0));

  if (!isSignedIn) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--surface)] px-6 py-12">
        <div className="pointer-events-none absolute -left-40 -top-40 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.22)_0%,_transparent_70%)]" />
        <div className="pointer-events-none absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_transparent_72%)]" />

        <div className="relative w-full max-w-sm rounded-3xl border border-[var(--stroke)] bg-white p-8 shadow-[var(--shadow)]">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--navy-dark)] text-white">
              <BoardIcon className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-xl font-semibold leading-tight text-[var(--navy-dark)]">
                Sign in
              </h1>
              <p className="text-xs text-[var(--gray-text)]">
                Kanban Studio workspace
              </p>
            </div>
          </div>

          <form className="mt-7 space-y-4" onSubmit={handleSignIn}>
            <div>
              <label htmlFor="username" className="mb-1.5 block text-xs font-semibold text-[var(--navy-dark)]">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-xl border border-[var(--stroke)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--primary-blue)]"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-[var(--navy-dark)]">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-[var(--stroke)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--primary-blue)]"
              />
            </div>

            {error ? (
              <p className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                <AlertIcon className="h-4 w-4 shrink-0" />
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--secondary-purple)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Sign in
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--surface)]">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--stroke)] bg-white px-4 py-2.5 sm:px-6">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--navy-dark)] text-white">
          <BoardIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-display text-base font-semibold leading-tight text-[var(--navy-dark)]">
            Kanban Studio
          </h1>
          <p className="hidden text-xs text-[var(--gray-text)] sm:block">
            {board.columns.length} columns · {totalCards} cards
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setChatOpen((open) => !open)}
            aria-pressed={chatOpen}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
              chatOpen
                ? "border-transparent bg-[var(--secondary-purple)] text-white"
                : "border-[var(--stroke)] text-[var(--navy-dark)] hover:bg-[var(--surface)]"
            }`}
            title={chatOpen ? "Hide the assistant panel" : "Show the assistant panel"}
          >
            <PanelIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Assistant</span>
          </button>
          <span className="hidden items-center gap-2 rounded-xl border border-[var(--stroke)] px-3 py-2 text-xs font-semibold text-[var(--navy-dark)] md:flex">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary-blue)] text-[10px] font-bold uppercase text-white">
              {username.slice(0, 1)}
            </span>
            {username}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--stroke)] text-[var(--gray-text)] transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            aria-label="Log out"
            title="Log out"
          >
            <LogoutIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      {boardError ? (
        <p className="flex shrink-0 items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-xs font-medium text-red-600 sm:px-6">
          <AlertIcon className="h-4 w-4 shrink-0" />
          {boardError}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <section className="scroll-slim flex min-w-0 flex-1 items-stretch gap-3 overflow-x-auto px-4 py-4">
            {board.columns.map((column, index) => (
              <KanbanColumn
                key={column.id}
                column={column}
                accent={columnAccent(index)}
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
                <KanbanCardPreview card={activeCard} accent={activeAccent} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {chatOpen ? (
          <aside className="flex w-[300px] shrink-0 flex-col border-l border-[var(--stroke)] bg-white lg:w-[340px] xl:w-[360px]">
            <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--stroke)] px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(117,57,145,0.1)] text-[var(--secondary-purple)]">
                <SparkIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold leading-tight text-[var(--navy-dark)]">
                  AI Planner
                </h2>
                <p className="truncate text-[11px] text-[var(--gray-text)]">
                  Ask it to reshape the board
                </p>
              </div>
            </div>

            <div
              ref={chatScrollRef}
              className="scroll-slim flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-[var(--surface)] p-3"
            >
              {chatMessages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs leading-5 ${
                    message.role === "assistant"
                      ? "rounded-bl-md border border-[var(--stroke)] bg-white text-[var(--navy-dark)]"
                      : "ml-auto rounded-br-md bg-[var(--primary-blue)] text-white"
                  }`}
                >
                  {message.text}
                </div>
              ))}
              {isAiLoading ? (
                <div className="flex max-w-[88%] items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--stroke)] bg-white px-3 py-2 text-xs text-[var(--gray-text)]">
                  <SparkIcon className="h-3.5 w-3.5 animate-pulse" />
                  Thinking…
                </div>
              ) : null}
            </div>

            {aiError ? (
              <p className="flex shrink-0 items-center gap-2 border-t border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                <AlertIcon className="h-4 w-4 shrink-0" />
                {aiError}
              </p>
            ) : null}

            <form onSubmit={handleAskAI} className="shrink-0 border-t border-[var(--stroke)] p-3">
              <label className="sr-only" htmlFor="ai-question">
                Question
              </label>
              <textarea
                id="ai-question"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                rows={3}
                placeholder="Ask for a change to the board..."
                className="w-full resize-none rounded-xl border border-[var(--stroke)] bg-[var(--surface)] px-3 py-2 text-xs leading-5 text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
              />
              <button
                type="submit"
                disabled={isAiLoading || !chatInput.trim()}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--secondary-purple)] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <SendIcon className="h-4 w-4" />
                {isAiLoading ? "Sending..." : "Send"}
              </button>
            </form>
          </aside>
        ) : null}
      </div>
    </div>
  );
};
