"""Shared FastAPI dependencies: database connection, current user, board access."""

import sqlite3
from dataclasses import dataclass
from typing import Iterator

from fastapi import Depends, HTTPException, Path
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import repository
from .db import connect
from .repository import ROLE_RANK
from .security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


def get_db() -> Iterator[sqlite3.Connection]:
    with connect() as connection:
        yield connection


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    connection: sqlite3.Connection = Depends(get_db),
) -> sqlite3.Row:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = repository.get_user_by_id(connection, int(payload["sub"]))
    if user is None:
        raise HTTPException(status_code=401, detail="User no longer exists")
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Account is deactivated")
    return user


def get_current_admin(
    user: sqlite3.Row = Depends(get_current_user),
) -> sqlite3.Row:
    if not user["is_admin"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@dataclass
class BoardContext:
    board_id: int
    role: str
    user: sqlite3.Row
    connection: sqlite3.Connection


def resolve_board(
    connection: sqlite3.Connection, user: sqlite3.Row, board_id: int, minimum: str
) -> BoardContext:
    board = repository.get_board(connection, board_id)
    if board is None:
        raise HTTPException(status_code=404, detail="Board not found")

    role = repository.get_member_role(connection, board_id, user["id"])
    if role is None:
        raise HTTPException(status_code=404, detail="Board not found")

    if ROLE_RANK[role] < ROLE_RANK[minimum]:
        raise HTTPException(status_code=403, detail=f"Requires {minimum} access")
    return BoardContext(board_id=board_id, role=role, user=user, connection=connection)


def board_access(minimum: str):
    """Build a dependency that checks the caller's role on the path's board."""

    def dependency(
        board_id: int = Path(...),
        connection: sqlite3.Connection = Depends(get_db),
        user: sqlite3.Row = Depends(get_current_user),
    ) -> BoardContext:
        return resolve_board(connection, user, board_id, minimum)

    return dependency


def resolve_card(
    connection: sqlite3.Connection, user: sqlite3.Row, card_id: int, minimum: str
) -> tuple[sqlite3.Row, BoardContext]:
    card = repository.get_card(connection, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    context = resolve_board(connection, user, card["board_id"], minimum)
    return card, context


def card_access(minimum: str):
    def dependency(
        card_id: int = Path(...),
        connection: sqlite3.Connection = Depends(get_db),
        user: sqlite3.Row = Depends(get_current_user),
    ) -> tuple[sqlite3.Row, BoardContext]:
        return resolve_card(connection, user, card_id, minimum)

    return dependency


def resolve_column(
    connection: sqlite3.Connection, user: sqlite3.Row, column_id: int, minimum: str
) -> tuple[sqlite3.Row, BoardContext]:
    column = repository.get_column(connection, column_id)
    if column is None:
        raise HTTPException(status_code=404, detail="Column not found")
    context = resolve_board(connection, user, column["board_id"], minimum)
    return column, context


def column_access(minimum: str):
    def dependency(
        column_id: int = Path(...),
        connection: sqlite3.Connection = Depends(get_db),
        user: sqlite3.Row = Depends(get_current_user),
    ) -> tuple[sqlite3.Row, BoardContext]:
        return resolve_column(connection, user, column_id, minimum)

    return dependency
