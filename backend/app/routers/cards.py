"""Cards, card moves, checklists, and comments."""

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from .. import repository
from ..deps import (
    BoardContext,
    board_access,
    card_access,
    get_current_user,
    get_db,
    resolve_board,
)
from ..models import (
    CardCreate,
    CardMove,
    CardUpdate,
    ChecklistItemCreate,
    ChecklistItemUpdate,
    CommentCreate,
)

router = APIRouter(prefix="/api", tags=["cards"])


def _detail(context: BoardContext) -> dict[str, Any]:
    board = repository.board_detail(context.connection, context.board_id, context.role)
    if board is None:
        raise HTTPException(status_code=404, detail="Board not found")
    return board


def _require_column(context: BoardContext, column_id: int) -> sqlite3.Row:
    column = repository.get_column(context.connection, column_id)
    if column is None or column["board_id"] != context.board_id:
        raise HTTPException(status_code=404, detail="Column not found")
    return column


@router.post("/boards/{board_id}/cards", status_code=201)
def create_card(
    payload: CardCreate, context: BoardContext = Depends(board_access("editor"))
) -> dict[str, Any]:
    _require_column(context, payload.column_id)
    if payload.assignee_id is not None:
        if repository.get_member_role(
            context.connection, context.board_id, payload.assignee_id
        ) is None:
            raise HTTPException(status_code=400, detail="Assignee is not a board member")

    card_id = repository.create_card(
        context.connection,
        context.board_id,
        payload.column_id,
        payload.title.strip(),
        payload.details,
        payload.priority,
        payload.assignee_id,
        payload.due_date,
        payload.estimate,
        context.user["id"],
    )
    if payload.label_ids:
        repository.set_card_labels(
            context.connection, card_id, context.board_id, payload.label_ids
        )
    repository.log_activity(
        context.connection,
        context.board_id,
        context.user["id"],
        "card.create",
        f"created card {payload.title.strip()}",
    )
    return _detail(context)


@router.get("/cards/{card_id}")
def read_card(
    access: tuple[sqlite3.Row, BoardContext] = Depends(card_access("viewer")),
) -> dict[str, Any]:
    card, context = access
    connection = context.connection
    labels = repository.card_labels(connection, context.board_id).get(card["id"], [])
    checklist = repository.checklists_for_board(connection, context.board_id).get(
        card["id"], []
    )
    comments = repository.list_comments(connection, card["id"])
    assignee = (
        repository.get_user_by_id(connection, card["assignee_id"])
        if card["assignee_id"]
        else None
    )
    detail = repository.serialize_card(
        card, labels, checklist, len(comments), assignee["username"] if assignee else None
    )
    detail["comments"] = comments
    return detail


@router.patch("/cards/{card_id}")
def patch_card(
    payload: CardUpdate,
    access: tuple[sqlite3.Row, BoardContext] = Depends(card_access("editor")),
) -> dict[str, Any]:
    card, context = access
    changes: dict[str, Any] = {}
    if payload.title is not None:
        changes["title"] = payload.title.strip()
    if payload.details is not None:
        changes["details"] = payload.details
    if payload.priority is not None:
        changes["priority"] = payload.priority
    if payload.clear_assignee:
        changes["assignee_id"] = None
    elif payload.assignee_id is not None:
        if repository.get_member_role(
            context.connection, context.board_id, payload.assignee_id
        ) is None:
            raise HTTPException(status_code=400, detail="Assignee is not a board member")
        changes["assignee_id"] = payload.assignee_id
    if payload.clear_due_date:
        changes["due_date"] = None
    elif payload.due_date is not None:
        changes["due_date"] = payload.due_date
    if payload.clear_estimate:
        changes["estimate"] = None
    elif payload.estimate is not None:
        changes["estimate"] = payload.estimate
    if payload.archived is not None:
        changes["archived"] = int(payload.archived)

    repository.update_card(context.connection, card["id"], changes)
    if payload.archived is not None:
        repository.normalize_card_positions(context.connection, card["column_id"])
    if payload.label_ids is not None:
        repository.set_card_labels(
            context.connection, card["id"], context.board_id, payload.label_ids
        )
    repository.touch_board(context.connection, context.board_id)
    repository.log_activity(
        context.connection,
        context.board_id,
        context.user["id"],
        "card.update",
        f"updated card {changes.get('title', card['title'])}",
    )
    return _detail(context)


@router.delete("/cards/{card_id}")
def remove_card(
    access: tuple[sqlite3.Row, BoardContext] = Depends(card_access("editor")),
) -> dict[str, Any]:
    card, context = access
    repository.delete_card(context.connection, card["id"])
    repository.log_activity(
        context.connection,
        context.board_id,
        context.user["id"],
        "card.delete",
        f"deleted card {card['title']}",
    )
    repository.touch_board(context.connection, context.board_id)
    return _detail(context)


@router.post("/cards/{card_id}/move")
def move_card(
    payload: CardMove,
    access: tuple[sqlite3.Row, BoardContext] = Depends(card_access("editor")),
) -> dict[str, Any]:
    card, context = access
    column = _require_column(context, payload.column_id)

    if column["wip_limit"] is not None and column["id"] != card["column_id"]:
        occupied = context.connection.execute(
            "SELECT COUNT(*) AS total FROM cards WHERE column_id = ? AND archived = 0",
            (column["id"],),
        ).fetchone()["total"]
        if occupied >= column["wip_limit"]:
            raise HTTPException(
                status_code=409,
                detail=f"Column {column['title']} is at its WIP limit",
            )

    repository.move_card(context.connection, card["id"], payload.column_id, payload.position)
    repository.log_activity(
        context.connection,
        context.board_id,
        context.user["id"],
        "card.move",
        f"moved card {card['title']} to {column['title']}",
    )
    return _detail(context)


# --------------------------------------------------------------------------
# Checklists
# --------------------------------------------------------------------------


@router.post("/cards/{card_id}/checklist", status_code=201)
def add_checklist_item(
    payload: ChecklistItemCreate,
    access: tuple[sqlite3.Row, BoardContext] = Depends(card_access("editor")),
) -> dict[str, Any]:
    card, context = access
    repository.create_checklist_item(context.connection, card["id"], payload.text.strip())
    repository.touch_board(context.connection, context.board_id)
    return _detail(context)


@router.patch("/checklist/{item_id}")
def patch_checklist_item(
    item_id: int,
    payload: ChecklistItemUpdate,
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_db),
) -> dict[str, Any]:
    item = repository.get_checklist_item(connection, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    card = repository.get_card(connection, item["card_id"])
    context = resolve_board(connection, user, card["board_id"], "editor")

    repository.update_checklist_item(
        connection,
        item_id,
        payload.text.strip() if payload.text is not None else None,
        payload.done,
    )
    repository.touch_board(connection, context.board_id)
    return _detail(context)


@router.delete("/checklist/{item_id}")
def remove_checklist_item(
    item_id: int,
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_db),
) -> dict[str, Any]:
    item = repository.get_checklist_item(connection, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    card = repository.get_card(connection, item["card_id"])
    context = resolve_board(connection, user, card["board_id"], "editor")

    repository.delete_checklist_item(connection, item_id)
    repository.touch_board(connection, context.board_id)
    return _detail(context)


# --------------------------------------------------------------------------
# Comments
# --------------------------------------------------------------------------


@router.get("/cards/{card_id}/comments")
def read_comments(
    access: tuple[sqlite3.Row, BoardContext] = Depends(card_access("viewer")),
) -> list[dict[str, Any]]:
    card, context = access
    return repository.list_comments(context.connection, card["id"])


@router.post("/cards/{card_id}/comments", status_code=201)
def add_comment(
    payload: CommentCreate,
    access: tuple[sqlite3.Row, BoardContext] = Depends(card_access("editor")),
) -> list[dict[str, Any]]:
    card, context = access
    repository.create_comment(
        context.connection, card["id"], context.user["id"], payload.body.strip()
    )
    repository.log_activity(
        context.connection,
        context.board_id,
        context.user["id"],
        "comment.create",
        f"commented on {card['title']}",
    )
    return repository.list_comments(context.connection, card["id"])


@router.delete("/comments/{comment_id}")
def remove_comment(
    comment_id: int,
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_db),
) -> list[dict[str, Any]]:
    comment = repository.get_comment(connection, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    card = repository.get_card(connection, comment["card_id"])
    context = resolve_board(connection, user, card["board_id"], "viewer")

    # A comment can be removed by its author or by the board owner.
    if comment["user_id"] != user["id"] and context.role != "owner":
        raise HTTPException(status_code=403, detail="Cannot delete another user's comment")

    repository.delete_comment(connection, comment_id)
    return repository.list_comments(connection, card["id"])
