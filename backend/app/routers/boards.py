"""Boards, members, columns, labels, activity, and stats."""

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from .. import repository
from ..deps import BoardContext, board_access, column_access, get_current_user, get_db
from ..models import (
    BoardCreate,
    BoardUpdate,
    ColumnCreate,
    ColumnMove,
    ColumnUpdate,
    LabelCreate,
    LabelUpdate,
    MemberAdd,
    MemberUpdate,
)

router = APIRouter(prefix="/api", tags=["boards"])


def _require_label(context: BoardContext, label_id: int) -> sqlite3.Row:
    label = repository.get_label(context.connection, label_id)
    if label is None or label["board_id"] != context.board_id:
        raise HTTPException(status_code=404, detail="Label not found")
    return label


# --------------------------------------------------------------------------
# Boards
# --------------------------------------------------------------------------


@router.get("/boards")
def list_boards(
    include_archived: bool = False,
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_db),
) -> list[dict[str, Any]]:
    return repository.list_boards_for_user(connection, user["id"], include_archived)


@router.post("/boards", status_code=201)
def create_board(
    payload: BoardCreate,
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_db),
) -> dict[str, Any]:
    board_id = repository.create_board(
        connection, user["id"], payload.name.strip(), payload.description, payload.template
    )
    return repository.board_detail(connection, board_id, "owner")


@router.get("/boards/{board_id}")
def read_board(
    include_archived: bool = False,
    context: BoardContext = Depends(board_access("viewer")),
) -> dict[str, Any]:
    return context.detail(include_archived)


@router.patch("/boards/{board_id}")
def patch_board(
    payload: BoardUpdate, context: BoardContext = Depends(board_access("owner"))
) -> dict[str, Any]:
    repository.update_board(
        context.connection,
        context.board_id,
        payload.name.strip() if payload.name is not None else None,
        payload.description,
        payload.archived,
    )
    context.log("board.update", "updated board settings")
    return context.detail()


@router.delete("/boards/{board_id}", status_code=204)
def remove_board(context: BoardContext = Depends(board_access("owner"))) -> None:
    repository.delete_board(context.connection, context.board_id)


@router.get("/boards/{board_id}/stats")
def read_stats(context: BoardContext = Depends(board_access("viewer"))) -> dict[str, Any]:
    return repository.board_stats(context.connection, context.board_id)


@router.get("/boards/{board_id}/activity")
def read_activity(
    limit: int = 50, context: BoardContext = Depends(board_access("viewer"))
) -> list[dict[str, Any]]:
    return repository.list_activity(context.connection, context.board_id, min(limit, 200))


# --------------------------------------------------------------------------
# Members
# --------------------------------------------------------------------------


@router.get("/boards/{board_id}/members")
def read_members(
    context: BoardContext = Depends(board_access("viewer")),
) -> list[dict[str, Any]]:
    return repository.list_members(context.connection, context.board_id)


@router.post("/boards/{board_id}/members", status_code=201)
def add_member(
    payload: MemberAdd, context: BoardContext = Depends(board_access("owner"))
) -> list[dict[str, Any]]:
    target = repository.get_user_by_username(context.connection, payload.username.strip())
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target["id"] == context.user["id"]:
        raise HTTPException(status_code=400, detail="You already own this board")

    repository.add_member(context.connection, context.board_id, target["id"], payload.role)
    context.log("member.add", f"added {target['username']} as {payload.role}")
    return repository.list_members(context.connection, context.board_id)


@router.patch("/boards/{board_id}/members/{user_id}")
def change_member_role(
    user_id: int,
    payload: MemberUpdate,
    context: BoardContext = Depends(board_access("owner")),
) -> list[dict[str, Any]]:
    role = repository.get_member_role(context.connection, context.board_id, user_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if role == "owner":
        raise HTTPException(status_code=400, detail="The board owner's role is fixed")

    repository.add_member(context.connection, context.board_id, user_id, payload.role)
    return repository.list_members(context.connection, context.board_id)


@router.delete("/boards/{board_id}/members/{user_id}")
def remove_member(
    user_id: int, context: BoardContext = Depends(board_access("owner"))
) -> list[dict[str, Any]]:
    role = repository.get_member_role(context.connection, context.board_id, user_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if role == "owner":
        raise HTTPException(status_code=400, detail="The board owner cannot be removed")

    repository.remove_member(context.connection, context.board_id, user_id)
    context.log("member.remove", "removed a member")
    return repository.list_members(context.connection, context.board_id)


# --------------------------------------------------------------------------
# Columns
# --------------------------------------------------------------------------


@router.post("/boards/{board_id}/columns", status_code=201)
def add_column(
    payload: ColumnCreate, context: BoardContext = Depends(board_access("editor"))
) -> dict[str, Any]:
    repository.create_column(
        context.connection, context.board_id, payload.title.strip(), payload.wip_limit
    )
    context.log("column.create", f"added column {payload.title.strip()}")
    return context.detail()


@router.patch("/columns/{column_id}")
def patch_column(
    payload: ColumnUpdate,
    access: tuple[sqlite3.Row, BoardContext] = Depends(column_access("editor")),
) -> dict[str, Any]:
    column, context = access
    repository.update_column(
        context.connection,
        column["id"],
        payload.title.strip() if payload.title is not None else None,
        payload.wip_limit,
        payload.clear_wip_limit,
    )
    repository.touch_board(context.connection, context.board_id)
    return context.detail()


@router.delete("/columns/{column_id}")
def remove_column(
    access: tuple[sqlite3.Row, BoardContext] = Depends(column_access("editor")),
) -> dict[str, Any]:
    column, context = access
    repository.delete_column(context.connection, column["id"])
    context.log("column.delete", f"deleted column {column['title']}")
    repository.touch_board(context.connection, context.board_id)
    return context.detail()


@router.post("/columns/{column_id}/move")
def reorder_column(
    payload: ColumnMove,
    access: tuple[sqlite3.Row, BoardContext] = Depends(column_access("editor")),
) -> dict[str, Any]:
    column, context = access
    repository.move_column(context.connection, column["id"], payload.position)
    return context.detail()


# --------------------------------------------------------------------------
# Labels
# --------------------------------------------------------------------------


@router.post("/boards/{board_id}/labels", status_code=201)
def add_label(
    payload: LabelCreate, context: BoardContext = Depends(board_access("editor"))
) -> dict[str, Any]:
    repository.create_label(
        context.connection, context.board_id, payload.name.strip(), payload.color
    )
    return context.detail()


@router.patch("/boards/{board_id}/labels/{label_id}")
def patch_label(
    label_id: int,
    payload: LabelUpdate,
    context: BoardContext = Depends(board_access("editor")),
) -> dict[str, Any]:
    _require_label(context, label_id)
    repository.update_label(
        context.connection,
        label_id,
        payload.name.strip() if payload.name is not None else None,
        payload.color,
    )
    return context.detail()


@router.delete("/boards/{board_id}/labels/{label_id}")
def remove_label(
    label_id: int, context: BoardContext = Depends(board_access("editor"))
) -> dict[str, Any]:
    _require_label(context, label_id)
    repository.delete_label(context.connection, label_id)
    return context.detail()
