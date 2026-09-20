"""Data access for users, boards, and everything hanging off a board.

Every function takes an open sqlite3 connection so a route can do several
operations in one transaction.
"""

import sqlite3
from typing import Any

from .db import now_iso
from .security import hash_password

DEFAULT_COLUMNS = ("Backlog", "In Progress", "Review", "Done")

DEFAULT_LABELS = (
    ("Bug", "#ef4444"),
    ("Feature", "#3b82f6"),
    ("Chore", "#a855f7"),
)

ROLE_RANK = {"viewer": 0, "editor": 1, "owner": 2}


# --------------------------------------------------------------------------
# Users
# --------------------------------------------------------------------------


def serialize_user(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "email": row["email"],
        "full_name": row["full_name"],
        "is_admin": bool(row["is_admin"]),
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"],
    }


def get_user_by_id(connection: sqlite3.Connection, user_id: int) -> sqlite3.Row | None:
    return connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def get_user_by_username(connection: sqlite3.Connection, username: str) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()


def list_users(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute("SELECT * FROM users ORDER BY username").fetchall()
    return [serialize_user(row) for row in rows]


def create_user(
    connection: sqlite3.Connection,
    username: str,
    password: str,
    email: str = "",
    full_name: str = "",
    is_admin: bool = False,
) -> sqlite3.Row:
    cursor = connection.execute(
        """
        INSERT INTO users (username, email, full_name, password_hash, is_admin, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (username, email, full_name, hash_password(password), int(is_admin), now_iso()),
    )
    return get_user_by_id(connection, int(cursor.lastrowid))


def ensure_demo_user(connection: sqlite3.Connection) -> sqlite3.Row | None:
    """Seed the MVP demo account on an empty instance so sign-in works at once."""
    if connection.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"]:
        return None
    user = create_user(connection, "user", "password", "", "Demo User", is_admin=True)
    create_board(connection, user["id"], "My First Board", "", "kanban")
    return user


def update_user_profile(
    connection: sqlite3.Connection,
    user_id: int,
    email: str | None,
    full_name: str | None,
) -> sqlite3.Row | None:
    if email is not None:
        connection.execute("UPDATE users SET email = ? WHERE id = ?", (email, user_id))
    if full_name is not None:
        connection.execute(
            "UPDATE users SET full_name = ? WHERE id = ?", (full_name, user_id)
        )
    return get_user_by_id(connection, user_id)


def set_user_password(connection: sqlite3.Connection, user_id: int, password: str) -> None:
    connection.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (hash_password(password), user_id),
    )


def admin_update_user(
    connection: sqlite3.Connection,
    user_id: int,
    is_active: bool | None,
    is_admin: bool | None,
) -> sqlite3.Row | None:
    if is_active is not None:
        connection.execute(
            "UPDATE users SET is_active = ? WHERE id = ?", (int(is_active), user_id)
        )
    if is_admin is not None:
        connection.execute(
            "UPDATE users SET is_admin = ? WHERE id = ?", (int(is_admin), user_id)
        )
    return get_user_by_id(connection, user_id)


# --------------------------------------------------------------------------
# Boards and membership
# --------------------------------------------------------------------------


def get_member_role(
    connection: sqlite3.Connection, board_id: int, user_id: int
) -> str | None:
    row = connection.execute(
        "SELECT role FROM board_members WHERE board_id = ? AND user_id = ?",
        (board_id, user_id),
    ).fetchone()
    return row["role"] if row else None


def get_board(connection: sqlite3.Connection, board_id: int) -> sqlite3.Row | None:
    return connection.execute("SELECT * FROM boards WHERE id = ?", (board_id,)).fetchone()


def touch_board(connection: sqlite3.Connection, board_id: int) -> None:
    connection.execute(
        "UPDATE boards SET updated_at = ? WHERE id = ?", (now_iso(), board_id)
    )


def create_board(
    connection: sqlite3.Connection,
    owner_id: int,
    name: str,
    description: str = "",
    template: str = "kanban",
) -> int:
    timestamp = now_iso()
    cursor = connection.execute(
        """
        INSERT INTO boards (name, description, owner_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (name, description, owner_id, timestamp, timestamp),
    )
    board_id = int(cursor.lastrowid)
    connection.execute(
        "INSERT INTO board_members (board_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
        (board_id, owner_id, timestamp),
    )
    if template == "kanban":
        for position, title in enumerate(DEFAULT_COLUMNS):
            connection.execute(
                "INSERT INTO board_columns (board_id, title, position) VALUES (?, ?, ?)",
                (board_id, title, position),
            )
        for label_name, color in DEFAULT_LABELS:
            connection.execute(
                "INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)",
                (board_id, label_name, color),
            )
    log_activity(connection, board_id, owner_id, "board.create", f"created board {name}")
    return board_id


def list_boards_for_user(
    connection: sqlite3.Connection, user_id: int, include_archived: bool = False
) -> list[dict[str, Any]]:
    query = """
        SELECT b.*, m.role AS member_role, u.username AS owner_username
        FROM boards b
        JOIN board_members m ON m.board_id = b.id
        JOIN users u ON u.id = b.owner_id
        WHERE m.user_id = ?
    """
    if not include_archived:
        query += " AND b.archived = 0"
    query += " ORDER BY b.updated_at DESC"

    boards = []
    for row in connection.execute(query, (user_id,)).fetchall():
        stats = board_stats(connection, row["id"])
        boards.append(
            {
                "id": row["id"],
                "name": row["name"],
                "description": row["description"],
                "archived": bool(row["archived"]),
                "owner_id": row["owner_id"],
                "owner_username": row["owner_username"],
                "role": row["member_role"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "stats": stats,
            }
        )
    return boards


def update_board(
    connection: sqlite3.Connection,
    board_id: int,
    name: str | None,
    description: str | None,
    archived: bool | None,
) -> None:
    if name is not None:
        connection.execute("UPDATE boards SET name = ? WHERE id = ?", (name, board_id))
    if description is not None:
        connection.execute(
            "UPDATE boards SET description = ? WHERE id = ?", (description, board_id)
        )
    if archived is not None:
        connection.execute(
            "UPDATE boards SET archived = ? WHERE id = ?", (int(archived), board_id)
        )
    touch_board(connection, board_id)


def delete_board(connection: sqlite3.Connection, board_id: int) -> None:
    connection.execute("DELETE FROM boards WHERE id = ?", (board_id,))


def list_members(connection: sqlite3.Connection, board_id: int) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT u.id, u.username, u.full_name, u.email, m.role, m.created_at
        FROM board_members m
        JOIN users u ON u.id = m.user_id
        WHERE m.board_id = ?
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.username
        """,
        (board_id,),
    ).fetchall()
    return [
        {
            "user_id": row["id"],
            "username": row["username"],
            "full_name": row["full_name"],
            "email": row["email"],
            "role": row["role"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def add_member(
    connection: sqlite3.Connection, board_id: int, user_id: int, role: str
) -> None:
    connection.execute(
        """
        INSERT INTO board_members (board_id, user_id, role, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(board_id, user_id) DO UPDATE SET role = excluded.role
        """,
        (board_id, user_id, role, now_iso()),
    )


def remove_member(connection: sqlite3.Connection, board_id: int, user_id: int) -> None:
    connection.execute(
        "DELETE FROM board_members WHERE board_id = ? AND user_id = ?",
        (board_id, user_id),
    )
    # Leaving them on their cards would show a non-member as the assignee and
    # count them in the stats, and the assignee picker only offers members.
    connection.execute(
        "UPDATE cards SET assignee_id = NULL, updated_at = ? WHERE board_id = ? AND assignee_id = ?",
        (now_iso(), board_id, user_id),
    )


# --------------------------------------------------------------------------
# Columns
# --------------------------------------------------------------------------


def get_column(connection: sqlite3.Connection, column_id: int) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT * FROM board_columns WHERE id = ?", (column_id,)
    ).fetchone()


def create_column(
    connection: sqlite3.Connection, board_id: int, title: str, wip_limit: int | None
) -> int:
    row = connection.execute(
        "SELECT COALESCE(MAX(position) + 1, 0) AS next FROM board_columns WHERE board_id = ?",
        (board_id,),
    ).fetchone()
    cursor = connection.execute(
        "INSERT INTO board_columns (board_id, title, position, wip_limit) VALUES (?, ?, ?, ?)",
        (board_id, title, row["next"], wip_limit),
    )
    touch_board(connection, board_id)
    return int(cursor.lastrowid)


def update_column(
    connection: sqlite3.Connection,
    column_id: int,
    title: str | None,
    wip_limit: int | None,
    clear_wip_limit: bool,
) -> None:
    if title is not None:
        connection.execute(
            "UPDATE board_columns SET title = ? WHERE id = ?", (title, column_id)
        )
    if clear_wip_limit:
        connection.execute(
            "UPDATE board_columns SET wip_limit = NULL WHERE id = ?", (column_id,)
        )
    elif wip_limit is not None:
        connection.execute(
            "UPDATE board_columns SET wip_limit = ? WHERE id = ?", (wip_limit, column_id)
        )


def delete_column(connection: sqlite3.Connection, column_id: int) -> None:
    column = get_column(connection, column_id)
    if column is None:
        return
    connection.execute("DELETE FROM board_columns WHERE id = ?", (column_id,))
    normalize_column_positions(connection, column["board_id"])


def normalize_column_positions(connection: sqlite3.Connection, board_id: int) -> None:
    rows = connection.execute(
        "SELECT id FROM board_columns WHERE board_id = ? ORDER BY position, id",
        (board_id,),
    ).fetchall()
    for position, row in enumerate(rows):
        connection.execute(
            "UPDATE board_columns SET position = ? WHERE id = ?", (position, row["id"])
        )


def move_column(connection: sqlite3.Connection, column_id: int, position: int) -> None:
    column = get_column(connection, column_id)
    if column is None:
        return
    rows = connection.execute(
        "SELECT id FROM board_columns WHERE board_id = ? ORDER BY position, id",
        (column["board_id"],),
    ).fetchall()
    ids = [row["id"] for row in rows if row["id"] != column_id]
    position = max(0, min(position, len(ids)))
    ids.insert(position, column_id)
    for index, identifier in enumerate(ids):
        connection.execute(
            "UPDATE board_columns SET position = ? WHERE id = ?", (index, identifier)
        )
    touch_board(connection, column["board_id"])


# --------------------------------------------------------------------------
# Labels
# --------------------------------------------------------------------------


def get_label(connection: sqlite3.Connection, label_id: int) -> sqlite3.Row | None:
    return connection.execute("SELECT * FROM labels WHERE id = ?", (label_id,)).fetchone()


def create_label(
    connection: sqlite3.Connection, board_id: int, name: str, color: str
) -> int:
    cursor = connection.execute(
        "INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)",
        (board_id, name, color),
    )
    return int(cursor.lastrowid)


def update_label(
    connection: sqlite3.Connection, label_id: int, name: str | None, color: str | None
) -> None:
    if name is not None:
        connection.execute("UPDATE labels SET name = ? WHERE id = ?", (name, label_id))
    if color is not None:
        connection.execute("UPDATE labels SET color = ? WHERE id = ?", (color, label_id))


def delete_label(connection: sqlite3.Connection, label_id: int) -> None:
    connection.execute("DELETE FROM labels WHERE id = ?", (label_id,))


def set_card_labels(
    connection: sqlite3.Connection, card_id: int, board_id: int, label_ids: list[int]
) -> None:
    connection.execute("DELETE FROM card_labels WHERE card_id = ?", (card_id,))
    for label_id in dict.fromkeys(label_ids):
        label = get_label(connection, label_id)
        if label is None or label["board_id"] != board_id:
            continue
        connection.execute(
            "INSERT INTO card_labels (card_id, label_id) VALUES (?, ?)",
            (card_id, label_id),
        )


# --------------------------------------------------------------------------
# Cards
# --------------------------------------------------------------------------


def get_card(connection: sqlite3.Connection, card_id: int) -> sqlite3.Row | None:
    return connection.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()


def create_card(
    connection: sqlite3.Connection,
    board_id: int,
    column_id: int,
    title: str,
    details: str,
    priority: str,
    assignee_id: int | None,
    due_date: str | None,
    estimate: float | None,
    created_by: int,
) -> int:
    row = connection.execute(
        """
        SELECT COALESCE(MAX(position) + 1, 0) AS next FROM cards
        WHERE column_id = ? AND archived = 0
        """,
        (column_id,),
    ).fetchone()
    timestamp = now_iso()
    cursor = connection.execute(
        """
        INSERT INTO cards (
            board_id, column_id, title, details, position, priority,
            assignee_id, due_date, estimate, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            board_id,
            column_id,
            title,
            details,
            row["next"],
            priority,
            assignee_id,
            due_date,
            estimate,
            created_by,
            timestamp,
            timestamp,
        ),
    )
    touch_board(connection, board_id)
    return int(cursor.lastrowid)


def update_card(connection: sqlite3.Connection, card_id: int, changes: dict[str, Any]) -> None:
    if not changes:
        return
    assignments = ", ".join(f"{column} = ?" for column in changes)
    values = list(changes.values())
    values.append(now_iso())
    values.append(card_id)
    connection.execute(
        f"UPDATE cards SET {assignments}, updated_at = ? WHERE id = ?", values
    )


def delete_card(connection: sqlite3.Connection, card_id: int) -> None:
    card = get_card(connection, card_id)
    if card is None:
        return
    connection.execute("DELETE FROM cards WHERE id = ?", (card_id,))
    normalize_card_positions(connection, card["column_id"])


def normalize_card_positions(connection: sqlite3.Connection, column_id: int) -> None:
    rows = connection.execute(
        """
        SELECT id FROM cards WHERE column_id = ? AND archived = 0
        ORDER BY position, id
        """,
        (column_id,),
    ).fetchall()
    for position, row in enumerate(rows):
        connection.execute(
            "UPDATE cards SET position = ? WHERE id = ?", (position, row["id"])
        )


def move_card(
    connection: sqlite3.Connection, card_id: int, column_id: int, position: int
) -> None:
    card = get_card(connection, card_id)
    if card is None:
        return
    source_column_id = card["column_id"]
    connection.execute(
        "UPDATE cards SET column_id = ?, updated_at = ? WHERE id = ?",
        (column_id, now_iso(), card_id),
    )

    rows = connection.execute(
        """
        SELECT id FROM cards WHERE column_id = ? AND archived = 0 AND id != ?
        ORDER BY position, id
        """,
        (column_id, card_id),
    ).fetchall()
    ids = [row["id"] for row in rows]
    position = max(0, min(position, len(ids)))
    ids.insert(position, card_id)
    for index, identifier in enumerate(ids):
        connection.execute(
            "UPDATE cards SET position = ? WHERE id = ?", (index, identifier)
        )

    if source_column_id != column_id:
        normalize_card_positions(connection, source_column_id)
    touch_board(connection, card["board_id"])


def card_labels(connection: sqlite3.Connection, board_id: int) -> dict[int, list[int]]:
    rows = connection.execute(
        """
        SELECT cl.card_id, cl.label_id
        FROM card_labels cl
        JOIN cards c ON c.id = cl.card_id
        WHERE c.board_id = ?
        """,
        (board_id,),
    ).fetchall()
    mapping: dict[int, list[int]] = {}
    for row in rows:
        mapping.setdefault(row["card_id"], []).append(row["label_id"])
    return mapping


# --------------------------------------------------------------------------
# Checklists and comments
# --------------------------------------------------------------------------


def get_checklist_item(connection: sqlite3.Connection, item_id: int) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT * FROM checklist_items WHERE id = ?", (item_id,)
    ).fetchone()


def create_checklist_item(connection: sqlite3.Connection, card_id: int, text: str) -> int:
    row = connection.execute(
        "SELECT COALESCE(MAX(position) + 1, 0) AS next FROM checklist_items WHERE card_id = ?",
        (card_id,),
    ).fetchone()
    cursor = connection.execute(
        "INSERT INTO checklist_items (card_id, text, position) VALUES (?, ?, ?)",
        (card_id, text, row["next"]),
    )
    return int(cursor.lastrowid)


def update_checklist_item(
    connection: sqlite3.Connection, item_id: int, text: str | None, done: bool | None
) -> None:
    if text is not None:
        connection.execute(
            "UPDATE checklist_items SET text = ? WHERE id = ?", (text, item_id)
        )
    if done is not None:
        connection.execute(
            "UPDATE checklist_items SET done = ? WHERE id = ?", (int(done), item_id)
        )


def delete_checklist_item(connection: sqlite3.Connection, item_id: int) -> None:
    connection.execute("DELETE FROM checklist_items WHERE id = ?", (item_id,))


def checklists_for_board(
    connection: sqlite3.Connection, board_id: int
) -> dict[int, list[dict[str, Any]]]:
    rows = connection.execute(
        """
        SELECT i.* FROM checklist_items i
        JOIN cards c ON c.id = i.card_id
        WHERE c.board_id = ?
        ORDER BY i.card_id, i.position, i.id
        """,
        (board_id,),
    ).fetchall()
    mapping: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        mapping.setdefault(row["card_id"], []).append(
            {
                "id": row["id"],
                "text": row["text"],
                "done": bool(row["done"]),
                "position": row["position"],
            }
        )
    return mapping


def get_comment(connection: sqlite3.Connection, comment_id: int) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT * FROM comments WHERE id = ?", (comment_id,)
    ).fetchone()


def create_comment(
    connection: sqlite3.Connection, card_id: int, user_id: int, body: str
) -> int:
    cursor = connection.execute(
        "INSERT INTO comments (card_id, user_id, body, created_at) VALUES (?, ?, ?, ?)",
        (card_id, user_id, body, now_iso()),
    )
    return int(cursor.lastrowid)


def delete_comment(connection: sqlite3.Connection, comment_id: int) -> None:
    connection.execute("DELETE FROM comments WHERE id = ?", (comment_id,))


def list_comments(connection: sqlite3.Connection, card_id: int) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT c.*, u.username FROM comments c
        LEFT JOIN users u ON u.id = c.user_id
        WHERE c.card_id = ?
        ORDER BY c.id
        """,
        (card_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "card_id": row["card_id"],
            "user_id": row["user_id"],
            "username": row["username"] or "unknown",
            "body": row["body"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def comment_counts(connection: sqlite3.Connection, board_id: int) -> dict[int, int]:
    rows = connection.execute(
        """
        SELECT cm.card_id, COUNT(*) AS total FROM comments cm
        JOIN cards c ON c.id = cm.card_id
        WHERE c.board_id = ?
        GROUP BY cm.card_id
        """,
        (board_id,),
    ).fetchall()
    return {row["card_id"]: row["total"] for row in rows}


# --------------------------------------------------------------------------
# Activity
# --------------------------------------------------------------------------


def log_activity(
    connection: sqlite3.Connection,
    board_id: int,
    user_id: int | None,
    action: str,
    summary: str,
) -> None:
    connection.execute(
        "INSERT INTO activity (board_id, user_id, action, summary, created_at) VALUES (?, ?, ?, ?, ?)",
        (board_id, user_id, action, summary, now_iso()),
    )


def list_activity(
    connection: sqlite3.Connection, board_id: int, limit: int = 50
) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT a.*, u.username FROM activity a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE a.board_id = ?
        ORDER BY a.id DESC
        LIMIT ?
        """,
        (board_id, limit),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "action": row["action"],
            "summary": row["summary"],
            "username": row["username"] or "system",
            "created_at": row["created_at"],
        }
        for row in rows
    ]


# --------------------------------------------------------------------------
# AI conversation
# --------------------------------------------------------------------------


def add_ai_message(
    connection: sqlite3.Connection, board_id: int, user_id: int | None, role: str, content: str
) -> int:
    cursor = connection.execute(
        "INSERT INTO ai_messages (board_id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        (board_id, user_id, role, content, now_iso()),
    )
    return int(cursor.lastrowid)


def list_ai_messages(
    connection: sqlite3.Connection, board_id: int, limit: int = 40
) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT * FROM (
            SELECT * FROM ai_messages WHERE board_id = ? ORDER BY id DESC LIMIT ?
        ) ORDER BY id
        """,
        (board_id, limit),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "role": row["role"],
            "content": row["content"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def clear_ai_messages(connection: sqlite3.Connection, board_id: int) -> None:
    connection.execute("DELETE FROM ai_messages WHERE board_id = ?", (board_id,))


# --------------------------------------------------------------------------
# Board serialization and stats
# --------------------------------------------------------------------------


def serialize_card(
    row: sqlite3.Row,
    labels: list[int],
    checklist: list[dict[str, Any]],
    comment_total: int,
    assignee_username: str | None,
) -> dict[str, Any]:
    done = sum(1 for item in checklist if item["done"])
    return {
        "id": row["id"],
        "board_id": row["board_id"],
        "column_id": row["column_id"],
        "title": row["title"],
        "details": row["details"],
        "position": row["position"],
        "priority": row["priority"],
        "assignee_id": row["assignee_id"],
        "assignee_username": assignee_username,
        "due_date": row["due_date"],
        "estimate": row["estimate"],
        "archived": bool(row["archived"]),
        "label_ids": labels,
        "checklist": checklist,
        "checklist_done": done,
        "checklist_total": len(checklist),
        "comment_count": comment_total,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def board_detail(
    connection: sqlite3.Connection, board_id: int, role: str, include_archived: bool = False
) -> dict[str, Any] | None:
    board = get_board(connection, board_id)
    if board is None:
        return None

    usernames = {
        row["id"]: row["username"]
        for row in connection.execute("SELECT id, username FROM users").fetchall()
    }
    labels_by_card = card_labels(connection, board_id)
    checklists = checklists_for_board(connection, board_id)
    comments = comment_counts(connection, board_id)

    card_query = "SELECT * FROM cards WHERE board_id = ?"
    if not include_archived:
        card_query += " AND archived = 0"
    # Position order is what builds each column's card_ids; the cards list
    # itself is sorted by id below so it stays in stable creation order.
    card_query += " ORDER BY position, id"

    cards = []
    cards_by_column: dict[int, list[int]] = {}
    for row in connection.execute(card_query, (board_id,)).fetchall():
        card = serialize_card(
            row,
            labels_by_card.get(row["id"], []),
            checklists.get(row["id"], []),
            comments.get(row["id"], 0),
            usernames.get(row["assignee_id"]),
        )
        cards.append(card)
        if not card["archived"]:
            cards_by_column.setdefault(row["column_id"], []).append(row["id"])
    cards.sort(key=lambda card: card["id"])

    columns = [
        {
            "id": row["id"],
            "title": row["title"],
            "position": row["position"],
            "wip_limit": row["wip_limit"],
            "card_ids": cards_by_column.get(row["id"], []),
        }
        for row in connection.execute(
            "SELECT * FROM board_columns WHERE board_id = ? ORDER BY position, id",
            (board_id,),
        ).fetchall()
    ]

    label_rows = connection.execute(
        "SELECT * FROM labels WHERE board_id = ? ORDER BY id", (board_id,)
    ).fetchall()

    return {
        "id": board["id"],
        "name": board["name"],
        "description": board["description"],
        "archived": bool(board["archived"]),
        "owner_id": board["owner_id"],
        "owner_username": usernames.get(board["owner_id"]),
        "role": role,
        "created_at": board["created_at"],
        "updated_at": board["updated_at"],
        "columns": columns,
        "cards": cards,
        "labels": [
            {"id": row["id"], "name": row["name"], "color": row["color"]}
            for row in label_rows
        ],
        "members": list_members(connection, board_id),
        "stats": board_stats(connection, board_id),
    }


def board_stats(connection: sqlite3.Connection, board_id: int) -> dict[str, Any]:
    totals = connection.execute(
        """
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) AS archived,
            SUM(CASE WHEN archived = 0 AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue,
            SUM(CASE WHEN archived = 0 THEN COALESCE(estimate, 0) ELSE 0 END) AS estimate
        FROM cards WHERE board_id = ?
        """,
        (now_iso()[:10], board_id),
    ).fetchone()

    by_column = {
        row["column_id"]: row["total"]
        for row in connection.execute(
            """
            SELECT column_id, COUNT(*) AS total FROM cards
            WHERE board_id = ? AND archived = 0 GROUP BY column_id
            """,
            (board_id,),
        ).fetchall()
    }
    by_priority = {
        row["priority"]: row["total"]
        for row in connection.execute(
            """
            SELECT priority, COUNT(*) AS total FROM cards
            WHERE board_id = ? AND archived = 0 GROUP BY priority
            """,
            (board_id,),
        ).fetchall()
    }
    by_assignee = {
        (row["username"] or "unassigned"): row["total"]
        for row in connection.execute(
            """
            SELECT u.username, COUNT(*) AS total FROM cards c
            LEFT JOIN users u ON u.id = c.assignee_id
            WHERE c.board_id = ? AND c.archived = 0
            GROUP BY c.assignee_id
            """,
            (board_id,),
        ).fetchall()
    }

    total = totals["total"] or 0
    archived = totals["archived"] or 0
    return {
        "total_cards": total,
        "active_cards": total - archived,
        "archived_cards": archived,
        "overdue_cards": totals["overdue"] or 0,
        "total_estimate": round(totals["estimate"] or 0, 2),
        "cards_by_column": by_column,
        "cards_by_priority": by_priority,
        "cards_by_assignee": by_assignee,
    }
