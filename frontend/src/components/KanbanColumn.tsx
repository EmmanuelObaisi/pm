import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Card, Column } from "@/lib/kanban";
import { KanbanCard } from "@/components/KanbanCard";
import { NewCardForm } from "@/components/NewCardForm";

type KanbanColumnProps = {
  column: Column;
  cards: Card[];
  accent: string;
  onRename: (columnId: string, title: string) => void;
  onEditCard: (cardId: string, field: "title" | "details", value: string) => void;
  onAddCard: (columnId: string, title: string, details: string) => void;
  onDeleteCard: (columnId: string, cardId: string) => void;
};

export const KanbanColumn = ({
  column,
  cards,
  accent,
  onRename,
  onEditCard,
  onAddCard,
  onDeleteCard,
}: KanbanColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className="flex h-full min-w-[224px] flex-1 flex-col rounded-2xl border border-[var(--stroke)] bg-[var(--surface-strong)] transition-shadow"
      style={{
        boxShadow: isOver
          ? `0 0 0 2px ${accent}, 0 12px 28px rgba(3, 33, 71, 0.12)`
          : "0 1px 3px rgba(3, 33, 71, 0.06)",
      }}
      data-testid={`column-${column.id}`}
    >
      <header className="flex items-center gap-2.5 border-b border-[var(--stroke)] px-3 py-3">
        <span
          className="h-6 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <input
          value={column.title}
          onChange={(event) => onRename(column.id, event.target.value)}
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1 py-0.5 font-display text-sm font-semibold text-[var(--navy-dark)] outline-none transition hover:bg-[var(--surface)] focus:bg-[var(--surface)]"
          aria-label="Column title"
        />
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
          style={{ backgroundColor: `${accent}1a`, color: accent }}
        >
          {cards.length}
        </span>
      </header>

      <div className="scroll-slim flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        <SortableContext items={column.cardIds} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              accent={accent}
              onEdit={(field, value) => onEditCard(card.id, field, value)}
              onDelete={(cardId) => onDeleteCard(column.id, cardId)}
            />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-[var(--stroke)] px-3 py-8 text-center text-xs font-medium text-[var(--gray-text)]">
            Drop a card here
          </div>
        )}
      </div>

      <div className="border-t border-[var(--stroke)] p-2.5">
        <NewCardForm
          accent={accent}
          onAdd={(title, details) => onAddCard(column.id, title, details)}
        />
      </div>
    </section>
  );
};
