from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_get_board_creates_default_board_for_user() -> None:
    response = client.get("/api/board", params={"user": "user"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["columns"]
    assert payload["cards"]
    assert payload["cards"]["card-1"]["title"]


def test_put_board_persists_board_for_user() -> None:
    payload = {
        "columns": [
            {"id": "col-1", "title": "Backlog", "cardIds": ["card-1"]},
            {"id": "col-2", "title": "Done", "cardIds": []},
        ],
        "cards": {
            "card-1": {"id": "card-1", "title": "Published plan", "details": "Ready to ship"}
        },
    }

    response = client.put("/api/board", params={"user": "user"}, json=payload)

    assert response.status_code == 200
    assert response.json() == payload

    saved = client.get("/api/board", params={"user": "user"})
    assert saved.status_code == 200
    assert saved.json() == payload


def test_board_is_scoped_by_user() -> None:
    payload = {
        "columns": [{"id": "col-1", "title": "Only for Alice", "cardIds": []}],
        "cards": {},
    }

    create_response = client.put("/api/board", params={"user": "alice"}, json=payload)
    assert create_response.status_code == 200

    alice_board = client.get("/api/board", params={"user": "alice"})
    user_board = client.get("/api/board", params={"user": "user"})

    assert alice_board.json() == payload
    assert user_board.json()["columns"]
