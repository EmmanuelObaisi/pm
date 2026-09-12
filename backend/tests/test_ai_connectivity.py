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
