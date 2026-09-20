"""Registration, login, and profile management."""

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from .. import repository
from ..deps import get_current_admin, get_current_user, get_db
from ..models import (
    AdminUserUpdate,
    LoginRequest,
    PasswordChange,
    ProfileUpdate,
    RegisterRequest,
)
from ..security import create_access_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
admin_router = APIRouter(prefix="/api/admin", tags=["admin"])


def _session(user: sqlite3.Row) -> dict[str, Any]:
    return {
        "token": create_access_token(user["id"], user["username"]),
        "user": repository.serialize_user(user),
    }


@router.post("/register", status_code=201)
def register(
    payload: RegisterRequest, connection: sqlite3.Connection = Depends(get_db)
) -> dict[str, Any]:
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Username is required")
    if repository.get_user_by_username(connection, username) is not None:
        raise HTTPException(status_code=409, detail="Username is already taken")

    # The first account to exist owns the instance, so it gets admin rights.
    is_first = connection.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"] == 0
    user = repository.create_user(
        connection,
        username,
        payload.password,
        payload.email.strip(),
        payload.full_name.strip(),
        is_admin=is_first,
    )
    repository.create_board(connection, user["id"], "My First Board", "", "kanban")
    return _session(user)


@router.post("/login")
def login(
    payload: LoginRequest, connection: sqlite3.Connection = Depends(get_db)
) -> dict[str, Any]:
    user = repository.get_user_by_username(connection, payload.username.strip())
    if user is None or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Account is deactivated")
    return _session(user)


@router.get("/me")
def read_me(user: sqlite3.Row = Depends(get_current_user)) -> dict[str, Any]:
    return repository.serialize_user(user)


@router.patch("/me")
def update_me(
    payload: ProfileUpdate,
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_db),
) -> dict[str, Any]:
    updated = repository.update_user_profile(
        connection, user["id"], payload.email, payload.full_name
    )
    return repository.serialize_user(updated)


@router.post("/password")
def change_password(
    payload: PasswordChange,
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_db),
) -> dict[str, str]:
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    repository.set_user_password(connection, user["id"], payload.new_password)
    return {"status": "updated"}


@router.get("/users")
def search_users(
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_db),
) -> list[dict[str, Any]]:
    """Directory of active accounts, used when adding board members."""
    rows = connection.execute(
        "SELECT id, username, full_name FROM users WHERE is_active = 1 ORDER BY username"
    ).fetchall()
    return [
        {"id": row["id"], "username": row["username"], "full_name": row["full_name"]}
        for row in rows
    ]


@admin_router.get("/users")
def admin_list_users(
    admin: sqlite3.Row = Depends(get_current_admin),
    connection: sqlite3.Connection = Depends(get_db),
) -> list[dict[str, Any]]:
    return repository.list_users(connection)


@admin_router.patch("/users/{user_id}")
def admin_update_user(
    user_id: int,
    payload: AdminUserUpdate,
    admin: sqlite3.Row = Depends(get_current_admin),
    connection: sqlite3.Connection = Depends(get_db),
) -> dict[str, Any]:
    target = repository.get_user_by_id(connection, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target["id"] == admin["id"] and (
        payload.is_active is False or payload.is_admin is False
    ):
        raise HTTPException(
            status_code=400, detail="Admins cannot remove their own access"
        )
    updated = repository.admin_update_user(
        connection, user_id, payload.is_active, payload.is_admin
    )
    return repository.serialize_user(updated)
