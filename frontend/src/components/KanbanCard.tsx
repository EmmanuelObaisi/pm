import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { useState } from "react";
import type { Card } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  onEdit: (field: "title" | "details", value: string) => void;
  onDelete: (cardId: string) => void;
};

export const KanbanCard = ({ card, onEdit, onDelete }: KanbanCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "rounded-2xl border border-transparent bg-white px-4 py-4 shadow-[0_12px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      data-testid={`card-${card.id}`}
    >
      <div className="min-w-0">
        {isEditing ? (
          <>
            <label className="sr-only" htmlFor={`${card.id}-title`}>
              Card title
            </label>
            <input
              id={`${card.id}-title`}
              value={card.title}
              onChange={(event) => onEdit("title", event.target.value)}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              className="w-full rounded-lg border border-[var(--stroke)] bg-[var(--surface)] px-2 py-1 font-display text-base font-semibold text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
              aria-label="Card title"
            />
            <label className="sr-only" htmlFor={`${card.id}-details`}>
              Card details
            </label>
            <textarea
              id={`${card.id}-details`}
              value={card.details}
              onChange={(event) => onEdit("details", event.target.value)}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              rows={3}
              className="mt-2 w-full resize-none rounded-lg border border-[var(--stroke)] bg-[var(--surface)] px-2 py-1 text-sm leading-6 text-[var(--gray-text)] outline-none focus:border-[var(--primary-blue)]"
              aria-label="Card details"
            />
          </>
        ) : (
          <>
            <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
              {card.title}
            </h4>
            <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
              {card.details}
            </p>
          </>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setIsEditing((editing) => !editing)}
          className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--navy-dark)]"
          aria-label={`${isEditing ? "Finish" : "Edit"} ${card.title}`}
        >
          {isEditing ? "Done" : "Edit"}
        </button>
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--navy-dark)] active:cursor-grabbing"
          aria-label={`Move ${card.title}`}
          title="Move card"
        >
          Move
        </button>
        <button
          type="button"
          onClick={() => onDelete(card.id)}
          className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--navy-dark)]"
          aria-label={`Delete ${card.title}`}
        >
          Remove
        </button>
      </div>
    </article>
  );
};
