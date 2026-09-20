"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useState } from "react";

import * as api from "@/lib/api";
import {
  applyFilters,
  canEdit,
  cardsInColumn,
  emptyFilters,
  isNoOpMove,
  isOwner,
  parseDragId,
  resolveDrop,
  withCardMoved,
  type BoardFilters,
} from "@/lib/board";
import type { Board, Priority, User } from "@/lib/types";
import { PRIORITIES } from "@/lib/types";
import { BoardColumn } from "@/components/BoardColumn";
import { CardFace } from "@/components/BoardCard";
import { CardDrawer } from "@/components/CardDrawer";
import { ChatPanel } from "@/components/ChatPanel";
import { BoardSidebar } from "@/components/BoardSidebar";
import { Button, ErrorText, Input, Spinner } from "@/components/ui";

export const BoardView = ({
  boardId,
  currentUser,
  onBack,
}: {
  boardId: number;
  currentUser: User;
  onBack: () => void;
}) => {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<BoardFilters>(emptyFilters);
  const [openCardId, setOpenCardId] = useState<number | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<number | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [addingColumn, setAddingColumn] = useState(false);
  const [columnTitle, setColumnTitle] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks a card up, the arrow keys move it, space drops it.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    let cancelled = false;
    api
      .fetchBoard(boardId)
      .then((loaded) => {
        if (!cancelled) {
          setBoard(loaded);
          setError("");
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load the board");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  /** Every mutation returns the whole board, so state is replaced wholesale. */
  const run = useCallback(async (action: () => Promise<Board>) => {
    try {
      setBoard(await action());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work");
    }
  }, []);

  const editable = board ? canEdit(board) : false;
  const visible = useMemo(
    () => (board ? applyFilters(board, filters) : null),
    [board, filters]
  );

  const draggingCard = useMemo(
    () => board?.cards.find((card) => card.id === draggingCardId) ?? null,
    [board, draggingCardId]
  );

  const onDragStart = (event: DragStartEvent) => {
    const parsed = parseDragId(event.active.id);
    setDraggingCardId(parsed?.kind === "card" ? parsed.id : null);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setDraggingCardId(null);
    if (!board || !event.over) {
      return;
    }
    const drop = resolveDrop(board, String(event.active.id), String(event.over.id));
    if (!drop || isNoOpMove(board, drop.cardId, drop.columnId, drop.position)) {
      return;
    }

    // Show the move immediately, then let the server's board win.
    const optimistic = withCardMoved(board, drop.cardId, drop.columnId, drop.position);
    setBoard(optimistic);
    try {
      setBoard(await api.moveCard(drop.cardId, drop.columnId, drop.position));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not move the card");
      // Undo the optimistic move without clearing the message explaining why.
      setBoard(await api.fetchBoard(boardId));
    }
  };

  if (error && !board) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <ErrorText>{error}</ErrorText>
        <Button variant="secondary" className="mt-4" onClick={onBack}>
          Back to boards
        </Button>
      </div>
    );
  }

  if (!board || !visible) {
    return (
      <div className="px-6 py-10">
        <Spinner label="Loading board" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--stroke)] bg-white px-6 py-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Boards
        </Button>
        <div className="min-w-0">
          <h1 className="font-display truncate text-lg font-semibold">{board.name}</h1>
          <p className="truncate text-xs text-[var(--gray-text)]">
            {board.description || "No description"} · you are {board.role}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={showSidebar ? "primary" : "secondary"}
            size="sm"
            onClick={() => setShowSidebar(!showSidebar)}
          >
            Details
          </Button>
          <Button
            variant={showChat ? "primary" : "secondary"}
            size="sm"
            onClick={() => setShowChat(!showChat)}
          >
            Assistant
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--stroke)] bg-white px-6 py-3">
        <Input
          value={filters.search}
          onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          placeholder="Search cards"
          aria-label="Search cards"
          className="w-56"
        />
        <select
          aria-label="Filter by assignee"
          value={filters.assigneeId ?? ""}
          onChange={(event) =>
            setFilters({
              ...filters,
              assigneeId: event.target.value ? Number(event.target.value) : null,
            })
          }
          className="rounded-lg border border-[var(--stroke)] bg-white px-3 py-2 text-sm"
        >
          <option value="">Any assignee</option>
          {board.members.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.username}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by priority"
          value={filters.priority ?? ""}
          onChange={(event) =>
            setFilters({
              ...filters,
              priority: (event.target.value || null) as Priority | null,
            })
          }
          className="rounded-lg border border-[var(--stroke)] bg-white px-3 py-2 text-sm"
        >
          <option value="">Any priority</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by label"
          value={filters.labelId ?? ""}
          onChange={(event) =>
            setFilters({
              ...filters,
              labelId: event.target.value ? Number(event.target.value) : null,
            })
          }
          className="rounded-lg border border-[var(--stroke)] bg-white px-3 py-2 text-sm"
        >
          <option value="">Any label</option>
          {board.labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={() => setFilters(emptyFilters)}>
          Clear filters
        </Button>
        <span className="ml-auto text-xs text-[var(--gray-text)]">
          {board.stats.active_cards} cards · {board.stats.overdue_cards} overdue
        </span>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="flex min-h-0 flex-1">
        <div className="scroll-slim flex-1 overflow-x-auto px-6 py-5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <div className="flex items-start gap-4">
              {visible.columns.map((column) => (
                <BoardColumn
                  key={column.id}
                  column={column}
                  cards={cardsInColumn(visible, column.id)}
                  labels={board.labels}
                  editable={editable}
                  onOpenCard={setOpenCardId}
                  onAddCard={(columnId, title) =>
                    run(() => api.createCard(board.id, { column_id: columnId, title }))
                  }
                  onRename={(columnId, title) =>
                    run(() => api.updateColumn(columnId, { title }))
                  }
                  onDelete={(columnId) => {
                    if (window.confirm("Delete this column and its cards?")) {
                      void run(() => api.deleteColumn(columnId));
                    }
                  }}
                  onSetWipLimit={(columnId, limit) =>
                    run(() =>
                      api.updateColumn(columnId, {
                        wip_limit: limit,
                        clear_wip_limit: limit === null,
                      })
                    )
                  }
                />
              ))}

              {editable ? (
                <div className="w-72 shrink-0">
                  {addingColumn ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (columnTitle.trim()) {
                          void run(() => api.createColumn(board.id, columnTitle.trim()));
                          setColumnTitle("");
                          setAddingColumn(false);
                        }
                      }}
                      className="flex flex-col gap-2 rounded-2xl border border-[var(--stroke)] bg-white p-3"
                    >
                      <Input
                        value={columnTitle}
                        onChange={(event) => setColumnTitle(event.target.value)}
                        placeholder="Column title"
                        aria-label="New column title"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm">
                          Add
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setAddingColumn(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={() => setAddingColumn(true)}
                    >
                      Add column
                    </Button>
                  )}
                </div>
              ) : null}
            </div>

            <DragOverlay>
              {draggingCard ? (
                <CardFace card={draggingCard} labels={board.labels} dragging />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>

        {showSidebar ? (
          <BoardSidebar
            board={board}
            canManage={isOwner(board)}
            canEdit={editable}
            onBoardChange={setBoard}
            onClose={() => setShowSidebar(false)}
          />
        ) : null}

        {showChat ? (
          <ChatPanel
            board={board}
            editable={editable}
            onBoardChange={setBoard}
            onClose={() => setShowChat(false)}
          />
        ) : null}
      </div>

      {openCardId !== null ? (
        <CardDrawer
          key={openCardId}
          cardId={openCardId}
          board={board}
          currentUser={currentUser}
          editable={editable}
          onBoardChange={setBoard}
          onClose={() => setOpenCardId(null)}
        />
      ) : null}
    </div>
  );
};
