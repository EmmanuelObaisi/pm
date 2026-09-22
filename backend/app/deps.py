"""Shared FastAPI dependencies: database connection, current user, board access."""

import sqlite3
from dataclasses import dataclass
from typing import Any, Iterator

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

    def detail(self, include_archived: bool = False) -> dict[str, Any]:
        """The whole-board payload that every mutating route returns."""
        return repository.board_detail(
            self.connection, self.board_id, self.role, include_archived
        )

    def log(self, action: str, summary: str) -> None:
        repository.log_activity(
            self.connection, self.board_id, self.user["id"], action, summary
        )


def resolve_board(
    connection: sqlite3.Connection, user: sqlite3.Row, board_id: int, minimum: str
) -> BoardContext:
    # A board that does not exist has no members either, so both cases answer
    # 404 here and board existence never leaks to a non-member.
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


def card_access(minimum: str):
    """Build a dependency resolving the path's card and its board access."""

    def dependency(
        card_id: int = Path(...),
        connection: sqlite3.Connection = Depends(get_db),
        user: sqlite3.Row = Depends(get_current_user),
    ) -> tuple[sqlite3.Row, BoardContext]:
        card = repository.get_card(connection, card_id)
        if card is None:
            raise HTTPException(status_code=404, detail="Card not found")
        return card, resolve_board(connection, user, card["board_id"], minimum)

    return dependency


def column_access(minimum: str):
    """Build a dependency resolving the path's column and its board access."""

    def dependency(
        column_id: int = Path(...),
        connection: sqlite3.Connection = Depends(get_db),
        user: sqlite3.Row = Depends(get_current_user),
    ) -> tuple[sqlite3.Row, BoardContext]:
        column = repository.get_column(connection, column_id)
        if column is None:
            raise HTTPException(status_code=404, detail="Column not found")
        return column, resolve_board(connection, user, column["board_id"], minimum)

    return dependency


def checklist_access(minimum: str):
    """Build a dependency resolving the path's checklist item and its board."""

    def dependency(
        item_id: int = Path(...),
        connection: sqlite3.Connection = Depends(get_db),
        user: sqlite3.Row = Depends(get_current_user),
    ) -> tuple[sqlite3.Row, BoardContext]:
        item = repository.get_checklist_item(connection, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Checklist item not found")
        card = repository.get_card(connection, item["card_id"])
        return item, resolve_board(connection, user, card["board_id"], minimum)

    return dependency
