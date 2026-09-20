"""The MVP stored one JSON blob per user; those databases must still open."""

import json
import sqlite3

import pytest

from app import db, repository
from app.security import verify_password

LEGACY_BOARD = {
    "columns": [
        {"id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"]},
        {"id": "col-done", "title": "Done", "cardIds": ["card-3"]},
        {"id": "col-empty", "title": "Empty", "cardIds": []},
    ],
    "cards": {
        "card-1": {"id": "card-1", "title": "Align roadmap", "details": "Themes"},
        "card-2": {"id": "card-2", "title": "Gather signals", "details": "Support tags"},
        "card-3": {"id": "card-3", "title": "Ship page", "details": "Copy approved"},
    },
}


@pytest.fixture
def legacy_db(monkeypatch, tmp_path):
    """A database in the old shape, not yet migrated."""
    path = tmp_path / "legacy.db"
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE);
        CREATE TABLE boards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            board_json TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        """
    )
    connection.execute("INSERT INTO users (username) VALUES ('user')")
    connection.execute(
        "INSERT INTO boards (user_id, board_json) VALUES (1, ?)",
        (json.dumps(LEGACY_BOARD),),
    )
    connection.commit()
    connection.close()

    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(db, "_initialized", set())
    return path


def test_legacy_users_and_boards_survive_the_migration(legacy_db):
    db.init_db()
    with db.connect() as connection:
        users = repository.list_users(connection)
        assert [user["username"] for user in users] == ["user"]

        boards = repository.list_boards_for_user(connection, users[0]["id"])
        assert len(boards) == 1
        assert boards[0]["role"] == "owner"


def test_legacy_columns_and_cards_keep_their_order(legacy_db):
    db.init_db()
    with db.connect() as connection:
        user = repository.get_user_by_username(connection, "user")
        board_id = repository.list_boards_for_user(connection, user["id"])[0]["id"]
        board = repository.board_detail(connection, board_id, "owner")

    assert [column["title"] for column in board["columns"]] == [
        "Backlog",
        "Done",
        "Empty",
    ]
    assert [card["title"] for card in board["cards"]] == [
        "Align roadmap",
        "Gather signals",
        "Ship page",
    ]
    assert board["columns"][0]["card_ids"] == [
        board["cards"][0]["id"],
        board["cards"][1]["id"],
    ]
    assert board["columns"][2]["card_ids"] == []
    assert board["cards"][0]["details"] == "Themes"


def test_the_migrated_account_signs_in_with_the_mvp_password(legacy_db, client):
    db.init_db()
    response = client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "user"

    with db.connect() as connection:
        user = repository.get_user_by_username(connection, "user")
    assert verify_password("password", user["password_hash"])


def test_the_migration_only_runs_once(legacy_db):
    db.init_db()
    with db.connect() as connection:
        first = repository.list_users(connection)

    db._initialized.clear()
    db.init_db()
    with db.connect() as connection:
        second = repository.list_users(connection)
        boards = repository.list_boards_for_user(connection, second[0]["id"])

    assert len(second) == len(first) == 1
    assert len(boards) == 1


def test_a_fresh_database_reports_no_migration(tmp_path):
    connection = sqlite3.connect(tmp_path / "fresh.db")
    connection.row_factory = sqlite3.Row
    try:
        assert db.migrate_legacy_schema(connection) is False
    finally:
        connection.close()


def test_a_legacy_board_for_a_missing_user_is_skipped(monkeypatch, tmp_path):
    path = tmp_path / "orphan.db"
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE);
        CREATE TABLE boards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            board_json TEXT NOT NULL
        );
        """
    )
    connection.execute(
        "INSERT INTO boards (user_id, board_json) VALUES (77, ?)",
        (json.dumps(LEGACY_BOARD),),
    )
    connection.commit()
    connection.close()

    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(db, "_initialized", set())
    db.init_db()

    with db.connect() as connection:
        total = connection.execute("SELECT COUNT(*) AS total FROM boards").fetchone()
    assert total["total"] == 0
