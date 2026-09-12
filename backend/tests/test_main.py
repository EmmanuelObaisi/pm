from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root_serves_html_when_frontend_is_built() -> None:
    frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "out"
    response = client.get("/")

    if frontend_dist.exists():
        assert response.status_code == 200
        assert "Kanban Studio" in response.text
    else:
        assert response.status_code == 404


def test_api_hello() -> None:
    response = client.get("/api/hello")

    assert response.status_code == 200
    assert response.json() == {"message": "hello world"}


def test_health() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
