"""OpenRouter client and the board operations the assistant can perform.

The MVP let the model return a whole replacement board, which silently dropped
anything it forgot to echo back. The assistant now returns a list of explicit
operations that are validated and applied one by one.
"""

import json
import os
import sqlite3
from typing import Any

import httpx
from fastapi import HTTPException

from . import repository
from .config import OPENROUTER_MODEL, OPENROUTER_URL

OPERATIONS = (
    "create_card",
    "update_card",
    "move_card",
    "delete_card",
    "archive_card",
    "create_column",
    "rename_column",
    "delete_column",
    "add_comment",
)

# Strict structured outputs require every property to be listed in "required",
# so optional arguments are expressed as nullable fields instead.
OPERATION_FIELDS = {
    "op": {"type": "string", "enum": list(OPERATIONS)},
    "card_id": {"type": ["integer", "null"]},
    "column_id": {"type": ["integer", "null"]},
    "title": {"type": ["string", "null"]},
    "details": {"type": ["string", "null"]},
    "priority": {"type": ["string", "null"], "enum": ["low", "medium", "high", "urgent", None]},
    "due_date": {"type": ["string", "null"]},
    "assignee": {"type": ["string", "null"]},
    "position": {"type": ["integer", "null"]},
    "body": {"type": ["string", "null"]},
}

RESPONSE_FORMAT: dict[str, Any] = {
    "type": "json_schema",
    "json_schema": {
        "name": "board_assistant",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "reply": {"type": "string"},
                "operations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": OPERATION_FIELDS,
                        "required": list(OPERATION_FIELDS),
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["reply", "operations"],
            "additionalProperties": False,
        },
    },
}

SYSTEM_PROMPT = """You are a project management assistant for a Kanban board.

You can answer questions about the board and change it by returning operations.
Always set every field of an operation, using null for the ones that do not apply.

Operations:
- create_card: needs column_id and title; may set details, priority, due_date, assignee
- update_card: needs card_id; may set title, details, priority, due_date, assignee
- move_card: needs card_id and column_id; position is the 0-based slot in the target column
- delete_card: needs card_id
- archive_card: needs card_id
- create_column: needs title
- rename_column: needs column_id and title
- delete_column: needs column_id (this also deletes its cards)
- add_comment: needs card_id and body

Rules:
- Only use ids that exist in the board state you are given.
- due_date must be YYYY-MM-DD. priority is one of low, medium, high, urgent.
- assignee must be the username of a board member.
- Return an empty operations list when the user only asks a question.
- Keep the reply short and state what you changed."""


def get_api_key() -> str:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is not configured.")
    return api_key


def call_openrouter(
    messages: list[dict[str, str]], response_format: dict[str, Any] | None = None
) -> str:
    payload: dict[str, Any] = {"model": OPENROUTER_MODEL, "messages": messages}
    if response_format is not None:
        payload["response_format"] = response_format

    try:
        response = httpx.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {get_api_key()}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost",
                "X-Title": "Project Management",
            },
            json=payload,
            timeout=60,
        )
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502, detail=f"OpenRouter request failed: {error}"
        ) from error

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"OpenRouter call failed ({response.status_code}): {response.text}",
        )

    try:
        return response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise HTTPException(
            status_code=502, detail="OpenRouter returned an unexpected response."
        ) from error


def board_context(board: dict[str, Any]) -> str:
    """Compact view of the board, so the prompt stays small on large boards."""
    columns = [
        {"id": column["id"], "title": column["title"], "card_ids": column["card_ids"]}
        for column in board["columns"]
    ]
    cards = [
        {
            "id": card["id"],
            "column_id": card["column_id"],
            "title": card["title"],
            "details": card["details"],
            "priority": card["priority"],
            "due_date": card["due_date"],
            "assignee": card["assignee_username"],
        }
        for card in board["cards"]
    ]
    return json.dumps(
        {
            "board": {"id": board["id"], "name": board["name"]},
            "columns": columns,
            "cards": cards,
            "labels": board["labels"],
            "members": [
                {"username": member["username"], "role": member["role"]}
                for member in board["members"]
            ],
        }
    )


class OperationError(Exception):
    """A single operation could not be applied; the rest still run."""


def _card_on_board(connection: sqlite3.Connection, board_id: int, card_id: Any) -> sqlite3.Row:
    if not isinstance(card_id, int):
        raise OperationError("card_id is required")
    card = repository.get_card(connection, card_id)
    if card is None or card["board_id"] != board_id:
        raise OperationError(f"card {card_id} is not on this board")
    return card


def _column_on_board(
    connection: sqlite3.Connection, board_id: int, column_id: Any
) -> sqlite3.Row:
    if not isinstance(column_id, int):
        raise OperationError("column_id is required")
    column = repository.get_column(connection, column_id)
    if column is None or column["board_id"] != board_id:
        raise OperationError(f"column {column_id} is not on this board")
    return column


def _assignee_id(
    connection: sqlite3.Connection, board_id: int, username: Any
) -> int | None:
    if not username:
        return None
    user = repository.get_user_by_username(connection, str(username))
    if user is None or repository.get_member_role(connection, board_id, user["id"]) is None:
        raise OperationError(f"{username} is not a member of this board")
    return user["id"]


def _required_text(operation: dict[str, Any], field: str) -> str:
    value = (operation.get(field) or "").strip()
    if not value:
        raise OperationError(f"{field} is required")
    return value


def apply_operation(
    connection: sqlite3.Connection,
    board_id: int,
    actor_id: int,
    operation: dict[str, Any],
) -> str:
    """Apply one operation and return a human-readable summary."""
    op = operation.get("op")

    if op == "create_card":
        column = _column_on_board(connection, board_id, operation.get("column_id"))
        title = _required_text(operation, "title")
        card_id = repository.create_card(
            connection,
            board_id,
            column["id"],
            title,
            operation.get("details") or "",
            operation.get("priority") or "medium",
            _assignee_id(connection, board_id, operation.get("assignee")),
            operation.get("due_date"),
            None,
            actor_id,
        )
        return f"created card {title} (#{card_id}) in {column['title']}"

    if op == "update_card":
        card = _card_on_board(connection, board_id, operation.get("card_id"))
        changes: dict[str, Any] = {}
        if operation.get("title"):
            changes["title"] = operation["title"].strip()
        if operation.get("details") is not None:
            changes["details"] = operation["details"]
        if operation.get("priority"):
            changes["priority"] = operation["priority"]
        if operation.get("due_date") is not None:
            changes["due_date"] = operation["due_date"]
        if operation.get("assignee"):
            changes["assignee_id"] = _assignee_id(connection, board_id, operation["assignee"])
        if not changes:
            raise OperationError("nothing to update")
        repository.update_card(connection, card["id"], changes)
        return f"updated card {changes.get('title', card['title'])} (#{card['id']})"

    if op == "move_card":
        card = _card_on_board(connection, board_id, operation.get("card_id"))
        column = _column_on_board(connection, board_id, operation.get("column_id"))
        position = operation.get("position")
        repository.move_card(
            connection, card["id"], column["id"], position if isinstance(position, int) else 0
        )
        return f"moved card {card['title']} to {column['title']}"

    if op == "delete_card":
        card = _card_on_board(connection, board_id, operation.get("card_id"))
        repository.delete_card(connection, card["id"])
        return f"deleted card {card['title']}"

    if op == "archive_card":
        card = _card_on_board(connection, board_id, operation.get("card_id"))
        repository.update_card(connection, card["id"], {"archived": 1})
        repository.normalize_card_positions(connection, card["column_id"])
        return f"archived card {card['title']}"

    if op == "create_column":
        title = _required_text(operation, "title")
        repository.create_column(connection, board_id, title, None)
        return f"created column {title}"

    if op == "rename_column":
        column = _column_on_board(connection, board_id, operation.get("column_id"))
        title = _required_text(operation, "title")
        repository.update_column(connection, column["id"], title, None, False)
        return f"renamed column {column['title']} to {title}"

    if op == "delete_column":
        column = _column_on_board(connection, board_id, operation.get("column_id"))
        repository.delete_column(connection, column["id"])
        return f"deleted column {column['title']}"

    if op == "add_comment":
        card = _card_on_board(connection, board_id, operation.get("card_id"))
        body = _required_text(operation, "body")
        repository.create_comment(connection, card["id"], actor_id, body)
        return f"commented on {card['title']}"

    raise OperationError(f"unknown operation {op}")


def apply_operations(
    connection: sqlite3.Connection,
    board_id: int,
    actor_id: int,
    operations: list[Any],
) -> tuple[list[str], list[str]]:
    applied: list[str] = []
    errors: list[str] = []
    for operation in operations:
        if not isinstance(operation, dict):
            errors.append("operation was not an object")
            continue
        try:
            summary = apply_operation(connection, board_id, actor_id, operation)
        except OperationError as error:
            errors.append(str(error))
            continue
        applied.append(summary)
        repository.log_activity(connection, board_id, actor_id, "ai.operation", summary)

    if applied:
        repository.touch_board(connection, board_id)
    return applied, errors


def ask(
    connection: sqlite3.Connection,
    board: dict[str, Any],
    actor_id: int,
    question: str,
    history: list[dict[str, Any]],
) -> dict[str, Any]:
    messages = [
        {
            "role": "system",
            "content": f"{SYSTEM_PROMPT}\n\nCurrent board state:\n{board_context(board)}",
        }
    ]
    for entry in history:
        if entry["role"] in ("user", "assistant") and entry["content"]:
            messages.append({"role": entry["role"], "content": entry["content"]})
    messages.append({"role": "user", "content": question})

    content = call_openrouter(messages, RESPONSE_FORMAT)
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=502, detail="AI response was not valid JSON."
        ) from error

    operations = parsed.get("operations") or []
    if not isinstance(operations, list):
        operations = []

    applied, errors = apply_operations(connection, board["id"], actor_id, operations)
    return {
        "reply": parsed.get("reply", ""),
        "applied": applied,
        "errors": errors,
    }
