import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { useState } from "react";
import type { Card } from "@/lib/kanban";
import { CheckIcon, GripIcon, PencilIcon, TrashIcon } from "@/components/icons";

type KanbanCardProps = {
  card: Card;
  accent: string;
  onEdit: (field: "title" | "details", value: string) => void;
  onDelete: (cardId: string) => void;
};

const iconButton =
  "flex h-6 w-6 items-center justify-center rounded-md text-[var(--gray-text)] transition hover:bg-[var(--surface)] hover:text-[var(--navy-dark)]";

export const KanbanCard = ({ card, accent, onEdit, onDelete }: KanbanCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    borderLeftColor: accent,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "group relative rounded-xl border border-[var(--stroke)] border-l-[3px] bg-white p-2.5 shadow-[0_1px_3px_rgba(3,33,71,0.06)]",
        "transition-shadow duration-150 hover:shadow-[0_8px_20px_rgba(3,33,71,0.1)]",
        isDragging && "opacity-50 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      data-testid={`card-${card.id}`}
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="-ml-0.5 mt-px flex h-5 w-4 shrink-0 cursor-grab items-center justify-center rounded text-[var(--gray-text)] opacity-50 transition hover:opacity-100 active:cursor-grabbing"
          aria-label={`Move ${card.title}`}
          title="Drag to move"
        >
          <GripIcon className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
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
                className="w-full rounded-lg border border-[var(--stroke)] bg-[var(--surface)] px-2 py-1 font-display text-sm font-semibold text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
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
                className="mt-1.5 w-full resize-none rounded-lg border border-[var(--stroke)] bg-[var(--surface)] px-2 py-1 text-xs leading-5 text-[var(--gray-text)] outline-none focus:border-[var(--primary-blue)]"
                aria-label="Card details"
              />
            </>
          ) : (
            <>
              <div aria-hidden className="float-right h-5 w-[50px]" />
              <h4 className="break-words font-display text-sm font-semibold leading-5 text-[var(--navy-dark)]">
                {card.title}
              </h4>
              <p className="mt-1 break-words text-xs leading-5 text-[var(--gray-text)]">
                {card.details}
              </p>
            </>
          )}
        </div>
      </div>

      <div
        className={clsx(
          "flex items-center gap-0.5",
          isEditing
            ? "mt-2 justify-end"
            : "absolute right-1.5 top-1.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
        )}
      >
        <button
          type="button"
          onClick={() => setIsEditing((editing) => !editing)}
          className={iconButton}
          aria-label={`${isEditing ? "Finish" : "Edit"} ${card.title}`}
          title={isEditing ? "Done" : "Edit card"}
        >
          {isEditing ? <CheckIcon className="h-4 w-4" /> : <PencilIcon className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => onDelete(card.id)}
          className={clsx(iconButton, "hover:bg-red-50 hover:text-red-600")}
          aria-label={`Delete ${card.title}`}
          title="Delete card"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
};
