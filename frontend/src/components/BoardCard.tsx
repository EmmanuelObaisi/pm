"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";

import { cardDragId, formatDate, isOverdue } from "@/lib/board";
import type { Card, Label } from "@/lib/types";
import { Badge } from "@/components/ui";

const PRIORITY_STYLE: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-sky-100 text-sky-700",
  low: "bg-slate-100 text-slate-600",
};

export const CardFace = ({
  card,
  labels,
  dragging,
}: {
  card: Card;
  labels: Label[];
  dragging?: boolean;
}) => {
  const cardLabels = labels.filter((label) => card.label_ids.includes(label.id));
  const overdue = isOverdue(card);

  return (
    <article
      className={clsx(
        "flex flex-col gap-2 rounded-xl border border-[var(--stroke)] bg-white p-3 text-left shadow-sm",
        dragging && "rotate-2 shadow-[var(--shadow)]"
      )}
    >
      {cardLabels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {cardLabels.map((label) => (
            <Badge key={label.id} color={label.color}>
              {label.name}
            </Badge>
          ))}
        </div>
      ) : null}

      <h3 className="text-sm font-medium leading-snug text-[var(--navy-dark)]">
        {card.title}
      </h3>

      {card.details ? (
        <p className="line-clamp-2 text-xs text-[var(--gray-text)]">{card.details}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--gray-text)]">
        <Badge className={PRIORITY_STYLE[card.priority]}>{card.priority}</Badge>

        {card.due_date ? (
          <span className={clsx(overdue && "font-medium text-red-600")}>
            {overdue ? "Overdue " : "Due "}
            {formatDate(card.due_date)}
          </span>
        ) : null}

        {card.checklist_total > 0 ? (
          <span aria-label="Checklist progress">
            {card.checklist_done}/{card.checklist_total}
          </span>
        ) : null}

        {card.comment_count > 0 ? (
          <span aria-label="Comments">{card.comment_count} comments</span>
        ) : null}

        {card.estimate !== null ? <span>{card.estimate}h</span> : null}

        {card.assignee_username ? (
          <span className="ml-auto rounded-full bg-[var(--surface)] px-2 py-0.5">
            {card.assignee_username}
          </span>
        ) : null}
      </div>
    </article>
  );
};

export const BoardCard = ({
  card,
  labels,
  onOpen,
  draggable,
}: {
  card: Card;
  labels: Label[];
  onOpen: (cardId: number) => void;
  draggable: boolean;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: cardDragId(card.id), disabled: !draggable });

  // The card itself is the drag handle. dnd-kit's attributes carry
  // role="button", so nesting a second control inside would be invalid ARIA.
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(isDragging && "opacity-40")}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        onClick={() => onOpen(card.id)}
        className="w-full cursor-pointer text-left"
        aria-label={`Open card ${card.title}`}
      >
        <CardFace card={card} labels={labels} />
      </button>
    </li>
  );
};
