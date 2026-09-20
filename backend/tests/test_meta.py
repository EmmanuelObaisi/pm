from fastapi.testclient import TestClient

from app import db, repository
from app.main import app


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_hello(client):
    assert client.get("/api/hello").json() == {"message": "hello world"}


def test_startup_seeds_the_demo_account():
    """The lifespan handler runs when the app is served for real."""
    with TestClient(app) as started:
        response = started.post(
            "/api/auth/login", json={"username": "user", "password": "password"}
        )
    assert response.status_code == 200
    assert response.json()["user"]["is_admin"] is True


def test_startup_leaves_an_existing_instance_alone(alice):
    with TestClient(app):
        pass
    with db.connect() as connection:
        assert [user["username"] for user in repository.list_users(connection)] == ["alice"]


def test_openapi_document_builds(client):
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "Project Management API"
    assert "/api/boards/{board_id}" in schema["paths"]
