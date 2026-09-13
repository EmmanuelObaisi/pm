import json
import os
import sqlite3
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = (BASE_DIR.parent / "project_management.db").resolve()
FRONTEND_DIST = (BASE_DIR / ".." / ".." / "frontend" / "out").resolve()
load_dotenv((BASE_DIR.parent.parent / ".env").resolve())

DEFAULT_BOARD: dict[str, Any] = {
    "columns": [
        {"id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"]},
        {"id": "col-discovery", "title": "Discovery", "cardIds": ["card-3"]},
        {"id": "col-progress", "title": "In Progress", "cardIds": ["card-4", "card-5"]},
        {"id": "col-review", "title": "Review", "cardIds": ["card-6"]},
        {"id": "col-done", "title": "Done", "cardIds": ["card-7", "card-8"]},
    ],
    "cards": {
        "card-1": {
            "id": "card-1",
            "title": "Align roadmap themes",
            "details": "Draft quarterly themes with impact statements and metrics.",
        },
        "card-2": {
            "id": "card-2",
            "title": "Gather customer signals",
            "details": "Review support tags, sales notes, and churn feedback.",
        },
        "card-3": {
            "id": "card-3",
            "title": "Prototype analytics view",
            "details": "Sketch initial dashboard layout and key drill-downs.",
        },
        "card-4": {
            "id": "card-4",
            "title": "Refine status language",
            "details": "Standardize column labels and tone across the board.",
        },
        "card-5": {
            "id": "card-5",
            "title": "Design card layout",
            "details": "Add hierarchy and spacing for scanning dense lists.",
        },
        "card-6": {
            "id": "card-6",
            "title": "QA micro-interactions",
            "details": "Verify hover, focus, and loading states.",
        },
        "card-7": {
            "id": "card-7",
            "title": "Ship marketing page",
            "details": "Final copy approved and asset pack delivered.",
        },
        "card-8": {
            "id": "card-8",
            "title": "Close onboarding sprint",
            "details": "Document release notes and share internally.",
        },
    },
}

app = FastAPI(title="Project Management MVP Backend")


class AIRequestPayload(dict):
    pass


def get_openrouter_api_key() -> str:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is not configured.")
    return api_key


def call_openrouter(prompt: str) -> str:
    api_key = get_openrouter_api_key()
    try:
        response = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost",
                "X-Title": "Project Management MVP",
            },
            json={
                "model": "openai/gpt-oss-120b",
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=30,
        )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=f"OpenRouter request failed: {error}") from error

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"OpenRouter call failed ({response.status_code}): {response.text}",
        )

    payload = response.json()
    try:
        return payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise HTTPException(status_code=502, detail="OpenRouter returned an unexpected response.") from error


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS boards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                board_json TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
            """
        )
        connection.commit()


def ensure_user(username: str) -> int:
    with get_connection() as connection:
        existing = connection.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone()

        if existing is not None:
            return int(existing["id"])

        cursor = connection.execute(
            "INSERT INTO users (username) VALUES (?)",
            (username,),
        )
        connection.commit()
        return int(cursor.lastrowid)


def default_board() -> dict[str, Any]:
    return json.loads(json.dumps(DEFAULT_BOARD))


def get_board_for_user(username: str) -> dict[str, Any]:
    init_db()
    user_id = ensure_user(username)

    with get_connection() as connection:
        row = connection.execute(
            "SELECT board_json FROM boards WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        if row is not None:
            return json.loads(row["board_json"])

        board = default_board()
        connection.execute(
            "INSERT INTO boards (user_id, board_json) VALUES (?, ?)",
            (user_id, json.dumps(board)),
        )
        connection.commit()
        return board


def save_board_for_user(username: str, board: dict[str, Any]) -> dict[str, Any]:
    init_db()
    user_id = ensure_user(username)
    payload = json.loads(json.dumps(board))

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO boards (user_id, board_json)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET board_json = excluded.board_json
            """,
            (user_id, json.dumps(payload)),
        )
        connection.commit()

    return payload


@app.get("/api/hello")
async def hello() -> dict[str, str]:
    return {"message": "hello world"}


@app.get("/api/board")
async def get_board(user: str) -> dict[str, Any]:
    return get_board_for_user(user)


@app.put("/api/board")
async def put_board(user: str, board: dict[str, Any]) -> dict[str, Any]:
    return save_board_for_user(user, board)


@app.post("/api/ai/test")
async def ai_test(payload: dict[str, str]) -> dict[str, str]:
    prompt = payload.get("prompt", "")
    answer = call_openrouter(prompt)
    return {"answer": answer.strip()}


@app.post("/api/ai/board")
async def ai_board(payload: dict[str, Any]) -> dict[str, Any]:
    user = payload.get("user", "")
    question = payload.get("question", "")
    history = payload.get("history", [])
    board = payload.get("board") or get_board_for_user(user)

    prompt = json.dumps(
        {
            "user": user,
            "question": question,
            "conversation_history": history,
            "kanban_board": board,
            "response_format": {
                "reply": "string",
                "board_update": {
                    "type": "object",
                    "nullable": True,
                    "description": "Optional updated kanban board JSON"
                }
            },
        },
        indent=2,
    )

    content = call_openrouter(prompt)
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        parsed = {"reply": content, "board_update": None}

    if parsed.get("board_update"):
        save_board_for_user(user, parsed["board_update"])

    return parsed


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


init_db()
