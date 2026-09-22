"use client";

import { useEffect, useState } from "react";

import * as api from "@/lib/api";
import { formatDate } from "@/lib/board";
import { errorMessage } from "@/lib/errors";
import type { ActivityEntry, Board, Card, Member } from "@/lib/types";
import { Badge, Button, ErrorText, Input, Spinner } from "@/components/ui";

type Tab = "stats" | "members" | "labels" | "archive" | "activity";

const TABS: { id: Tab; label: string }[] = [
  { id: "stats", label: "Stats" },
  { id: "members", label: "Members" },
  { id: "labels", label: "Labels" },
  { id: "archive", label: "Archive" },
  { id: "activity", label: "Activity" },
];

export const BoardSidebar = ({
  board,
  canManage,
  canEdit,
  onBoardChange,
  onClose,
}: {
  board: Board;
  canManage: boolean;
  canEdit: boolean;
  onBoardChange: (board: Board) => void;
  onClose: () => void;
}) => {
  const [tab, setTab] = useState<Tab>("stats");
  // Member mutations return the fresh list, which then wins over the board's copy.
  const [memberEdits, setMemberEdits] = useState<Member[] | null>(null);
  const members = memberEdits ?? board.members;
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [archived, setArchived] = useState<Card[] | null>(null);
  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState<"editor" | "viewer">("editor");
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState("#64748b");
  const [error, setError] = useState("");

  useEffect(() => {
    if (tab !== "activity") {
      return;
    }
    let cancelled = false;
    api
      .fetchActivity(board.id)
      .then((loaded) => !cancelled && setActivity(loaded))
      .catch(() => !cancelled && setActivity([]));
    return () => {
      cancelled = true;
    };
  }, [tab, board.id, board.updated_at]);

  useEffect(() => {
    if (tab !== "archive") {
      return;
    }
    let cancelled = false;
    // Archived cards are left out of the board payload, so ask for them.
    api
      .fetchBoard(board.id, true)
      .then((full) =>
        !cancelled && setArchived(full.cards.filter((card) => card.archived))
      )
      .catch(() => !cancelled && setArchived([]));
    return () => {
      cancelled = true;
    };
  }, [tab, board.id, board.updated_at]);

  /** Every mutation here reports its own failure and leaves the panel as it was. */
  const run = async (fallback: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught, fallback));
    }
  };

  const addMember = (event: React.FormEvent) => {
    event.preventDefault();
    if (!memberName.trim()) {
      return;
    }
    void run("Could not add that member", async () => {
      setMemberEdits(await api.addMember(board.id, memberName.trim(), memberRole));
      setMemberName("");
      setError("");
    });
  };

  const dropArchived = (cardId: number) =>
    setArchived((current) => current?.filter((card) => card.id !== cardId) ?? null);

  const columnName = (columnId: string) =>
    board.columns.find((column) => String(column.id) === columnId)?.title ?? "Unknown";

  return (
    <aside
      aria-label="Board details"
      className="flex w-80 shrink-0 flex-col border-l border-[var(--stroke)] bg-white"
    >
      <header className="flex items-center justify-between border-b border-[var(--stroke)] px-4 py-3">
        <h2 className="font-display text-sm font-semibold">Board details</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>

      <nav className="flex gap-1 border-b border-[var(--stroke)] px-2 py-2">
        {TABS.map((entry) => (
          <Button
            key={entry.id}
            variant={tab === entry.id ? "primary" : "ghost"}
            size="sm"
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </nav>

      <div className="scroll-slim flex-1 overflow-y-auto px-4 py-4 text-sm">
        <ErrorText>{error}</ErrorText>

        {tab === "stats" ? (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-3">
              {[
                ["Active cards", board.stats.active_cards],
                ["Archived", board.stats.archived_cards],
                ["Overdue", board.stats.overdue_cards],
                ["Estimated hours", board.stats.total_estimate],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-[var(--surface)] px-3 py-2">
                  <dt className="text-xs text-[var(--gray-text)]">{label}</dt>
                  <dd className="font-display text-lg font-semibold">{value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="mb-1 text-xs font-medium text-[var(--gray-text)]">
                Cards per column
              </p>
              <ul className="flex flex-col gap-1">
                {Object.entries(board.stats.cards_by_column).map(([columnId, count]) => (
                  <li key={columnId} className="flex justify-between">
                    <span>{columnName(columnId)}</span>
                    <span>{count}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-[var(--gray-text)]">
                Cards per assignee
              </p>
              <ul className="flex flex-col gap-1">
                {Object.entries(board.stats.cards_by_assignee).map(([name, count]) => (
                  <li key={name} className="flex justify-between">
                    <span>{name}</span>
                    <span>{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {tab === "members" ? (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {members.map((member) => (
                <li key={member.user_id} className="flex items-center gap-2">
                  <span className="flex-1">
                    {member.username}
                    {member.full_name ? (
                      <span className="block text-xs text-[var(--gray-text)]">
                        {member.full_name}
                      </span>
                    ) : null}
                  </span>

                  {member.role === "owner" || !canManage ? (
                    <Badge className="bg-[var(--surface)] text-[var(--gray-text)]">
                      {member.role}
                    </Badge>
                  ) : (
                    <>
                      <select
                        value={member.role}
                        aria-label={`Role for ${member.username}`}
                        onChange={(event) => {
                          const role = event.target.value as "editor" | "viewer";
                          void run("Could not change that role", async () => {
                            setMemberEdits(
                              await api.updateMember(board.id, member.user_id, role)
                            );
                          });
                        }}
                        className="rounded-lg border border-[var(--stroke)] px-2 py-1 text-xs"
                      >
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${member.username}`}
                        onClick={() =>
                          run("Could not remove that member", async () => {
                            setMemberEdits(
                              await api.removeMember(board.id, member.user_id)
                            );
                          })
                        }
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>

            {canManage ? (
              <form onSubmit={addMember} className="flex flex-col gap-2">
                <Input
                  value={memberName}
                  onChange={(event) => setMemberName(event.target.value)}
                  placeholder="Username"
                  aria-label="Username to add"
                />
                <div className="flex gap-2">
                  <select
                    value={memberRole}
                    aria-label="Role for the new member"
                    onChange={(event) =>
                      setMemberRole(event.target.value as "editor" | "viewer")
                    }
                    className="flex-1 rounded-lg border border-[var(--stroke)] px-2 py-1 text-sm"
                  >
                    <option value="editor">editor</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <Button type="submit" size="sm">
                    Add member
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}

        {tab === "labels" ? (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {board.labels.map((label) => (
                <li key={label.id} className="flex items-center gap-2">
                  <Badge color={label.color}>{label.name}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    aria-label={`Delete label ${label.name}`}
                    onClick={() =>
                      run("Could not delete that label", async () => {
                        onBoardChange(await api.deleteLabel(board.id, label.id));
                      })
                    }
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!labelName.trim()) {
                  return;
                }
                void run("Could not create that label", async () => {
                  onBoardChange(
                    await api.createLabel(board.id, labelName.trim(), labelColor)
                  );
                  setLabelName("");
                });
              }}
              className="flex gap-2"
            >
              <Input
                value={labelName}
                onChange={(event) => setLabelName(event.target.value)}
                placeholder="Label name"
                aria-label="New label name"
              />
              <input
                type="color"
                value={labelColor}
                aria-label="New label colour"
                onChange={(event) => setLabelColor(event.target.value)}
                className="h-9 w-10 rounded border border-[var(--stroke)]"
              />
              <Button type="submit" size="sm">
                Add
              </Button>
            </form>
          </div>
        ) : null}

        {tab === "archive" ? (
          archived === null ? (
            <Spinner label="Loading archived cards" />
          ) : archived.length === 0 ? (
            <p className="text-[var(--gray-text)]">No archived cards.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {archived.map((card) => (
                <li
                  key={card.id}
                  className="flex items-center gap-2 border-b border-[var(--stroke)] pb-2"
                >
                  <span className="flex-1">{card.title}</span>
                  {canEdit ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Restore ${card.title}`}
                        onClick={() =>
                          run("Could not restore that card", async () => {
                            onBoardChange(
                              await api.updateCard(card.id, { archived: false })
                            );
                            dropArchived(card.id);
                          })
                        }
                      >
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${card.title}`}
                        onClick={() =>
                          run("Could not delete that card", async () => {
                            onBoardChange(await api.deleteCard(card.id));
                            dropArchived(card.id);
                          })
                        }
                      >
                        Delete
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "activity" ? (
          activity === null ? (
            <Spinner label="Loading activity" />
          ) : activity.length === 0 ? (
            <p className="text-[var(--gray-text)]">Nothing has happened yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {activity.map((entry) => (
                <li key={entry.id} className="border-b border-[var(--stroke)] pb-2">
                  <p>{entry.summary}</p>
                  <p className="text-xs text-[var(--gray-text)]">
                    {entry.username} · {formatDate(entry.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </aside>
  );
};
