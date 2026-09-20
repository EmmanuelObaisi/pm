"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import clsx from "clsx";
import { useState } from "react";

import { cardDragId, columnDragId, isOverWipLimit } from "@/lib/board";
import type { Card, Column, Label } from "@/lib/types";
import { BoardCard } from "@/components/BoardCard";
import { Button, Input } from "@/components/ui";

export const BoardColumn = ({
  column,
  cards,
  labels,
  editable,
  onOpenCard,
  onAddCard,
  onRename,
  onDelete,
  onSetWipLimit,
}: {
  column: Column;
  cards: Card[];
  labels: Label[];
  editable: boolean;
  onOpenCard: (cardId: number) => void;
  onAddCard: (columnId: number, title: string) => void;
  onRename: (columnId: number, title: string) => void;
  onDelete: (columnId: number) => void;
  onSetWipLimit: (columnId: number, limit: number | null) => void;
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: columnDragId(column.id) });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(column.title);

  const overLimit = isOverWipLimit(column);

  const submitCard = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    onAddCard(column.id, title.trim());
    setTitle("");
    setAdding(false);
  };

  const submitRename = (event: React.FormEvent) => {
    event.preventDefault();
    if (draftName.trim() && draftName.trim() !== column.title) {
      onRename(column.id, draftName.trim());
    }
    setRenaming(false);
  };

  const changeLimit = () => {
    const answer = window.prompt(
      `WIP limit for "${column.title}" (blank for none)`,
      column.wip_limit === null ? "" : String(column.wip_limit)
    );
    if (answer === null) {
      return;
    }
    const trimmed = answer.trim();
    if (trimmed === "") {
      onSetWipLimit(column.id, null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed > 0) {
      onSetWipLimit(column.id, parsed);
    }
  };

  return (
    <section
      ref={setNodeRef}
      aria-label={`Column ${column.title}`}
      className={clsx(
        "flex w-72 shrink-0 flex-col gap-3 rounded-2xl bg-white/70 p-3",
        "border border-[var(--stroke)]",
        isOver && "border-[var(--primary-blue)] bg-[var(--surface-strong)]"
      )}
    >
      <header className="flex items-start justify-between gap-2">
        {renaming ? (
          <form onSubmit={submitRename} className="flex-1">
            <Input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={submitRename}
              aria-label={`Rename column ${column.title}`}
              autoFocus
            />
          </form>
        ) : (
          <button
            type="button"
            disabled={!editable}
            onClick={() => {
              setDraftName(column.title);
              setRenaming(true);
            }}
            className="font-display text-sm font-semibold disabled:cursor-default"
          >
            {column.title}
          </button>
        )}

        <span
          className={clsx(
            "rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px]",
            overLimit ? "text-red-600" : "text-[var(--gray-text)]"
          )}
        >
          {column.card_ids.length}
          {column.wip_limit !== null ? `/${column.wip_limit}` : ""}
        </span>
      </header>

      {overLimit ? (
        <p role="alert" className="text-[11px] text-red-600">
          Over the WIP limit
        </p>
      ) : null}

      <SortableContext
        items={cards.map((card) => cardDragId(card.id))}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex min-h-[2rem] flex-col gap-2">
          {cards.map((card) => (
            <BoardCard
              key={card.id}
              card={card}
              labels={labels}
              onOpen={onOpenCard}
              draggable={editable}
            />
          ))}
        </ul>
      </SortableContext>

      {editable ? (
        adding ? (
          <form onSubmit={submitCard} className="flex flex-col gap-2">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Card title"
              aria-label={`New card in ${column.title}`}
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
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              Add card
            </Button>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={changeLimit}
                aria-label={`Set WIP limit for ${column.title}`}
              >
                WIP
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(column.id)}
                aria-label={`Delete column ${column.title}`}
              >
                Delete
              </Button>
            </div>
          </div>
        )
      ) : null}
    </section>
  );
};
