import type { Card } from "@/lib/kanban";
import { GripIcon } from "@/components/icons";

type KanbanCardPreviewProps = {
  card: Card;
  accent: string;
};

export const KanbanCardPreview = ({ card, accent }: KanbanCardPreviewProps) => (
  <article
    className="rotate-2 rounded-xl border border-[var(--stroke)] border-l-[3px] bg-white p-3 shadow-[0_18px_32px_rgba(3,33,71,0.18)]"
    style={{ borderLeftColor: accent }}
  >
    <div className="flex items-start gap-1.5">
      <GripIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--gray-text)]" />
      <div className="min-w-0">
        <h4 className="break-words font-display text-sm font-semibold leading-5 text-[var(--navy-dark)]">
          {card.title}
        </h4>
        <p className="mt-1 break-words text-xs leading-5 text-[var(--gray-text)]">
          {card.details}
        </p>
      </div>
    </div>
  </article>
);
