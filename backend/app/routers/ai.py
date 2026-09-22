"""Board-scoped AI assistant endpoints."""

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends

from .. import ai, repository
from ..deps import BoardContext, board_access, get_current_user
from ..models import AIRequest

router = APIRouter(prefix="/api", tags=["ai"])


@router.get("/boards/{board_id}/ai/messages")
def read_messages(
    context: BoardContext = Depends(board_access("viewer")),
) -> list[dict[str, Any]]:
    return repository.list_ai_messages(context.connection, context.board_id)


@router.delete("/boards/{board_id}/ai/messages", status_code=204)
def clear_messages(context: BoardContext = Depends(board_access("editor"))) -> None:
    repository.clear_ai_messages(context.connection, context.board_id)


@router.post("/boards/{board_id}/ai")
def ask_assistant(
    payload: AIRequest, context: BoardContext = Depends(board_access("editor"))
) -> dict[str, Any]:
    connection = context.connection
    board = context.detail()
    history = repository.list_ai_messages(connection, context.board_id, limit=20)

    result = ai.ask(connection, board, context.user["id"], payload.question, history)

    repository.add_ai_message(
        connection, context.board_id, context.user["id"], "user", payload.question
    )
    repository.add_ai_message(
        connection, context.board_id, None, "assistant", result["reply"]
    )

    return {
        "reply": result["reply"],
        "applied": result["applied"],
        "errors": result["errors"],
        "board": context.detail(),
    }


@router.post("/ai/test")
def ai_test(
    payload: dict[str, str],
    user: sqlite3.Row = Depends(get_current_user),
) -> dict[str, str]:
    """Connectivity smoke test against OpenRouter."""
    answer = ai.call_openrouter([{"role": "user", "content": payload.get("prompt", "")}])
    return {"answer": answer.strip()}
