import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

# PM_DB_PATH lets a throwaway instance (the e2e run, for one) keep its own file.
DB_PATH = Path(
    os.getenv("PM_DB_PATH")
    or Path(__file__).resolve().parent.parent / "project_management.db"
).resolve()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL DEFAULT '',
    full_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_members (
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (board_id, user_id)
);

CREATE TABLE IF NOT EXISTS board_columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL,
    wip_limit INTEGER
);

CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    column_id INTEGER NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    due_date TEXT,
    estimate REAL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_labels (
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, label_id)
);

CREATE TABLE IF NOT EXISTS checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_board ON cards(board_id);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id, position);
CREATE INDEX IF NOT EXISTS idx_columns_board ON board_columns(board_id, position);
CREATE INDEX IF NOT EXISTS idx_activity_board ON activity(board_id, id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_board ON ai_messages(board_id, id);
"""

_initialized: set[str] = set()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _open(path: str) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    path = str(DB_PATH)
    connection = _open(path)
    try:
        migrate_legacy_schema(connection)
        connection.executescript(SCHEMA)
        connection.commit()
        _initialized.add(path)
    finally:
        connection.close()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    path = str(DB_PATH)
    if path not in _initialized:
        init_db()

    connection = _open(path)
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    rows = connection.execute(f"PRAGMA table_info({table})").fetchall()
    return {row["name"] for row in rows}


def migrate_legacy_schema(connection: sqlite3.Connection) -> bool:
    """Convert the MVP schema (users + boards.board_json) to the current one.

    The MVP stored one board per user as a single JSON blob. Returns True when a
    migration ran, so a caller can tell a fresh database from an upgraded one.
    """
    tables = {
        row["name"]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    if "boards" not in tables or "board_json" not in table_columns(connection, "boards"):
        return False

    legacy_users = connection.execute("SELECT * FROM users").fetchall()
    legacy_boards = connection.execute("SELECT * FROM boards").fetchall()

    connection.execute("DROP TABLE boards")
    connection.execute("DROP TABLE users")
    connection.executescript(SCHEMA)

    timestamp = now_iso()
    # Legacy accounts had no stored password, so keep the MVP demo password.
    from .security import hash_password

    demo_hash = hash_password("password")
    user_ids: dict[int, int] = {}
    for row in legacy_users:
        cursor = connection.execute(
            """
            INSERT INTO users (username, email, full_name, password_hash, created_at)
            VALUES (?, '', '', ?, ?)
            """,
            (row["username"], demo_hash, timestamp),
        )
        user_ids[int(row["id"])] = int(cursor.lastrowid)

    for row in legacy_boards:
        owner_id = user_ids.get(int(row["user_id"]))
        if owner_id is None:
            continue
        board = json.loads(row["board_json"])
        board_cursor = connection.execute(
            """
            INSERT INTO boards (name, description, owner_id, created_at, updated_at)
            VALUES (?, '', ?, ?, ?)
            """,
            ("My Board", owner_id, timestamp, timestamp),
        )
        board_id = int(board_cursor.lastrowid)
        connection.execute(
            """
            INSERT INTO board_members (board_id, user_id, role, created_at)
            VALUES (?, ?, 'owner', ?)
            """,
            (board_id, owner_id, timestamp),
        )
        cards = board.get("cards", {})
        for column_position, column in enumerate(board.get("columns", [])):
            column_cursor = connection.execute(
                "INSERT INTO board_columns (board_id, title, position) VALUES (?, ?, ?)",
                (board_id, column.get("title", "Column"), column_position),
            )
            column_id = int(column_cursor.lastrowid)
            for card_position, card_id in enumerate(column.get("cardIds", [])):
                card = cards.get(card_id)
                if card is None:
                    continue
                connection.execute(
                    """
                    INSERT INTO cards (
                        board_id, column_id, title, details, position, created_by,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        board_id,
                        column_id,
                        card.get("title", "Card"),
                        card.get("details", ""),
                        card_position,
                        owner_id,
                        timestamp,
                        timestamp,
                    ),
                )

    connection.commit()
    return True
