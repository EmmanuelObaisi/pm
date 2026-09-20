"use client";

import { useEffect, useState } from "react";

import * as api from "@/lib/api";
import { formatDate } from "@/lib/board";
import type { Board, Comment, Priority, User } from "@/lib/types";
import { PRIORITIES } from "@/lib/types";
import { Badge, Button, ErrorText, Field, Input, Spinner } from "@/components/ui";

export const CardDrawer = ({
  cardId,
  board,
  currentUser,
  editable,
  onBoardChange,
  onClose,
}: {
  cardId: number;
  board: Board;
  currentUser: User;
  editable: boolean;
  onBoardChange: (board: Board) => void;
  onClose: () => void;
}) => {
  const card = board.cards.find((item) => item.id === cardId);

  const [title, setTitle] = useState(card?.title ?? "");
  const [details, setDetails] = useState(card?.details ?? "");
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [error, setError] = useState("");

  // The drawer is keyed on the card id, so the state above is re-initialized
  // whenever a different card is opened.

  useEffect(() => {
    let cancelled = false;
    api
      .fetchComments(cardId)
      .then((loaded) => {
        if (!cancelled) {
          setComments(loaded);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setComments([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  // The card is gone (deleted, archived, or filtered away); close the drawer.
  useEffect(() => {
    if (!card) {
      onClose();
    }
  }, [card, onClose]);

  if (!card) {
    return null;
  }

  const run = async (action: () => Promise<Board>) => {
    try {
      onBoardChange(await action());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work");
    }
  };

  const saveField = (payload: api.CardUpdatePayload) =>
    run(() => api.updateCard(card.id, payload));

  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!commentBody.trim()) {
      return;
    }
    try {
      setComments(await api.addComment(card.id, commentBody.trim()));
      setCommentBody("");
      onBoardChange(await api.fetchBoard(board.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not post the comment");
    }
  };

  const removeComment = async (commentId: number) => {
    try {
      setComments(await api.deleteComment(commentId));
      onBoardChange(await api.fetchBoard(board.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the comment");
    }
  };

  const toggleLabel = (labelId: number) => {
    const next = card.label_ids.includes(labelId)
      ? card.label_ids.filter((id) => id !== labelId)
      : [...card.label_ids, labelId];
    void saveField({ label_ids: next });
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <aside
        role="dialog"
        aria-label={`Card ${card.title}`}
        className="scroll-slim flex h-full w-full max-w-lg flex-col gap-5 overflow-y-auto bg-white p-6 shadow-[var(--shadow)]"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Card details</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <ErrorText>{error}</ErrorText>

        <Field label="Title">
          <Input
            value={title}
            disabled={!editable}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => title.trim() && title !== card.title && saveField({ title: title.trim() })}
          />
        </Field>

        <Field label="Description">
          <textarea
            value={details}
            disabled={!editable}
            onChange={(event) => setDetails(event.target.value)}
            onBlur={() => details !== card.details && saveField({ details })}
            rows={4}
            className="w-full rounded-lg border border-[var(--stroke)] px-3 py-2 text-sm outline-none focus:border-[var(--primary-blue)]"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Priority">
            <select
              value={card.priority}
              disabled={!editable}
              onChange={(event) =>
                saveField({ priority: event.target.value as Priority })
              }
              className="w-full rounded-lg border border-[var(--stroke)] bg-white px-3 py-2 text-sm"
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Assignee">
            <select
              value={card.assignee_id ?? ""}
              disabled={!editable}
              onChange={(event) =>
                saveField(
                  event.target.value
                    ? { assignee_id: Number(event.target.value) }
                    : { clear_assignee: true }
                )
              }
              className="w-full rounded-lg border border-[var(--stroke)] bg-white px-3 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {board.members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.username}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Due date">
            <Input
              type="date"
              value={card.due_date ?? ""}
              disabled={!editable}
              onChange={(event) =>
                saveField(
                  event.target.value
                    ? { due_date: event.target.value }
                    : { clear_due_date: true }
                )
              }
            />
          </Field>

          <Field label="Estimate (hours)">
            <Input
              type="number"
              min="0"
              step="0.5"
              value={card.estimate ?? ""}
              disabled={!editable}
              onChange={(event) =>
                saveField(
                  event.target.value
                    ? { estimate: Number(event.target.value) }
                    : { clear_estimate: true }
                )
              }
            />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Labels</p>
          <div className="flex flex-wrap gap-2">
            {board.labels.length === 0 ? (
              <p className="text-sm text-[var(--gray-text)]">No labels on this board.</p>
            ) : (
              board.labels.map((label) => {
                const active = card.label_ids.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    disabled={!editable}
                    onClick={() => toggleLabel(label.id)}
                    aria-pressed={active}
                    className="rounded-full"
                  >
                    <Badge
                      color={label.color}
                      className={active ? "ring-2 ring-offset-1" : "opacity-60"}
                    >
                      {label.name}
                    </Badge>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">
            Checklist ({card.checklist_done}/{card.checklist_total})
          </p>
          <ul className="flex flex-col gap-1.5">
            {card.checklist.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={!editable}
                  aria-label={item.text}
                  onChange={(event) =>
                    run(() =>
                      api.updateChecklistItem(item.id, { done: event.target.checked })
                    )
                  }
                />
                <span className={item.done ? "text-[var(--gray-text)] line-through" : ""}>
                  {item.text}
                </span>
                {editable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    aria-label={`Remove ${item.text}`}
                    onClick={() => run(() => api.deleteChecklistItem(item.id))}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          {editable ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (checklistText.trim()) {
                  void run(() => api.addChecklistItem(card.id, checklistText.trim()));
                  setChecklistText("");
                }
              }}
              className="mt-2 flex gap-2"
            >
              <Input
                value={checklistText}
                onChange={(event) => setChecklistText(event.target.value)}
                placeholder="Add a step"
                aria-label="New checklist item"
              />
              <Button type="submit" size="sm">
                Add
              </Button>
            </form>
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Comments</p>
          {comments === null ? (
            <Spinner label="Loading comments" />
          ) : comments.length === 0 ? (
            <p className="text-sm text-[var(--gray-text)]">No comments yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 text-xs text-[var(--gray-text)]">
                    <span className="font-medium text-[var(--navy-dark)]">
                      {comment.username}
                    </span>
                    <span>{formatDate(comment.created_at)}</span>
                    {comment.user_id === currentUser.id || board.role === "owner" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        aria-label={`Delete comment by ${comment.username}`}
                        onClick={() => removeComment(comment.id)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-1">{comment.body}</p>
                </li>
              ))}
            </ul>
          )}

          {editable ? (
            <form onSubmit={submitComment} className="mt-2 flex gap-2">
              <Input
                value={commentBody}
                onChange={(event) => setCommentBody(event.target.value)}
                placeholder="Write a comment"
                aria-label="New comment"
              />
              <Button type="submit" size="sm">
                Post
              </Button>
            </form>
          ) : null}
        </div>

        {editable ? (
          <div className="mt-auto flex gap-2 border-t border-[var(--stroke)] pt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => saveField({ archived: true })}
            >
              Archive
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (window.confirm("Delete this card?")) {
                  void run(() => api.deleteCard(card.id));
                }
              }}
            >
              Delete
            </Button>
          </div>
        ) : null}
      </aside>
    </div>
  );
};
