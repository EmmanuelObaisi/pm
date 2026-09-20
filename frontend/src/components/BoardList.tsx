"use client";

import { useCallback, useEffect, useState } from "react";

import * as api from "@/lib/api";
import type { BoardSummary } from "@/lib/types";
import { Button, EmptyState, ErrorText, Field, Input, Modal, Spinner } from "@/components/ui";

const ROLE_HINT: Record<string, string> = {
  owner: "You own this board",
  editor: "You can edit this board",
  viewer: "You can view this board",
};

export const BoardList = ({ onOpen }: { onOpen: (boardId: number) => void }) => {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<"kanban" | "empty">("kanban");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBoards(await api.fetchBoards(includeArchived));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load boards");
      setBoards([]);
    }
  }, [includeArchived]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const board = await api.createBoard({
        name: name.trim(),
        description: description.trim(),
        template,
      });
      setCreating(false);
      setName("");
      setDescription("");
      onOpen(board.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the board");
    } finally {
      setBusy(false);
    }
  };

  const setArchived = async (board: BoardSummary, archived: boolean) => {
    try {
      await api.updateBoard(board.id, { archived });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the board");
    }
  };

  const remove = async (board: BoardSummary) => {
    if (!window.confirm(`Delete "${board.name}" and everything on it?`)) {
      return;
    }
    try {
      await api.deleteBoard(board.id);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the board");
    }
  };

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Your boards</h1>
          <p className="text-sm text-[var(--gray-text)]">
            Boards you own and boards shared with you.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--gray-text)]">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            Show archived
          </label>
          <Button onClick={() => setCreating(true)}>New board</Button>
        </div>
      </header>

      <ErrorText>{error}</ErrorText>

      {boards === null ? (
        <Spinner label="Loading boards" />
      ) : boards.length === 0 ? (
        <EmptyState
          title="No boards yet"
          hint="Create a board to start planning work."
          action={<Button onClick={() => setCreating(true)}>New board</Button>}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <li
              key={board.id}
              className="flex flex-col gap-3 rounded-xl border border-[var(--stroke)] bg-white p-5 shadow-sm"
            >
              <button
                type="button"
                onClick={() => onOpen(board.id)}
                className="text-left"
              >
                <span className="font-display text-base font-semibold hover:text-[var(--primary-blue)]">
                  {board.name}
                </span>
                {board.archived ? (
                  <span className="ml-2 text-xs text-[var(--gray-text)]">(archived)</span>
                ) : null}
                <p className="mt-1 text-sm text-[var(--gray-text)]">
                  {board.description || "No description"}
                </p>
              </button>

              <dl className="flex gap-4 text-xs text-[var(--gray-text)]">
                <div>
                  <dt className="sr-only">Cards</dt>
                  <dd>{board.stats.active_cards} cards</dd>
                </div>
                <div>
                  <dt className="sr-only">Overdue</dt>
                  <dd>{board.stats.overdue_cards} overdue</dd>
                </div>
                <div>
                  <dt className="sr-only">Owner</dt>
                  <dd>by {board.owner_username}</dd>
                </div>
              </dl>

              <div className="flex items-center justify-between gap-2 border-t border-[var(--stroke)] pt-3">
                <span className="text-xs text-[var(--gray-text)]">
                  {ROLE_HINT[board.role]}
                </span>
                {board.role === "owner" ? (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setArchived(board, !board.archived)}
                    >
                      {board.archived ? "Restore" : "Archive"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(board)}>
                      Delete
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <Modal title="New board" onClose={() => setCreating(false)}>
          <form onSubmit={create} className="flex flex-col gap-4">
            <Field label="Name">
              <Input
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Description">
              <Input
                name="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field label="Template">
              <select
                name="template"
                value={template}
                onChange={(event) =>
                  setTemplate(event.target.value as "kanban" | "empty")
                }
                className="w-full rounded-lg border border-[var(--stroke)] bg-white px-3 py-2 text-sm"
              >
                <option value="kanban">Kanban (four columns and labels)</option>
                <option value="empty">Empty</option>
              </select>
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating..." : "Create board"}
            </Button>
          </form>
        </Modal>
      ) : null}
    </section>
  );
};
