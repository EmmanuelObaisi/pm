from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_ai_test_endpoint_returns_openrouter_response(monkeypatch) -> None:
    def fake_post(url, headers=None, json=None, timeout=None):
        class FakeResponse:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {"message": {"content": "4"}}
                    ]
                }

        return FakeResponse()

    monkeypatch.setattr("app.main.httpx.post", fake_post)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    response = client.post("/api/ai/test", json={"prompt": "2+2"})

    assert response.status_code == 200
    assert response.json()["answer"] == "4"


def test_ai_test_endpoint_requires_api_key(monkeypatch) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    response = client.post("/api/ai/test", json={"prompt": "2+2"})

    assert response.status_code == 500
    assert "OPENROUTER_API_KEY" in response.json()["detail"]


def test_ai_board_applies_a_board_update(monkeypatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    captured: dict = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["payload"] = json
        return type(
            "FakeResponse",
            (),
            {
                "status_code": 200,
                "json": lambda self: {
                    "choices": [
                        {
                            "message": {
                                "content": (
                                    '{"reply":"Moved the card.",'
                                    '"board_update":{"columns":[],"cards":[]}}'
                                )
                            }
                        }
                    ]
                },
            },
        )()

    monkeypatch.setattr("app.main.httpx.post", fake_post)

    response = client.post(
        "/api/ai/board",
        json={"user": "ai-test-user", "question": "Move a card", "board": {"columns": [], "cards": {}}},
    )

    assert response.status_code == 200
    assert response.json() == {
        "reply": "Moved the card.",
        "board_update": {"columns": [], "cards": {}},
    }
    assert captured["payload"]["response_format"]["type"] == "json_schema"
    assert captured["payload"]["response_format"]["json_schema"]["strict"] is True


def test_ai_board_rejects_non_json_response(monkeypatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(
        "app.main.httpx.post",
        lambda *args, **kwargs: type(
            "FakeResponse",
            (),
            {
                "status_code": 200,
                "json": lambda self: {
                    "choices": [{"message": {"content": "not json"}}]
                },
            },
        )(),
    )

    response = client.post(
        "/api/ai/board",
        json={"user": "ai-test-user", "question": "Move a card", "board": {"columns": [], "cards": {}}},
    )

    assert response.status_code == 502
