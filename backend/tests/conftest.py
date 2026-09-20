import pytest
from fastapi.testclient import TestClient

from app import config, db
from app.main import app


@pytest.fixture(autouse=True)
def isolate_database(monkeypatch, tmp_path):
    """Point every test at its own SQLite file and reset the init cache."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(db, "_initialized", set())
    # Real key stretching would dominate the suite's runtime.
    monkeypatch.setattr(config, "PASSWORD_ROUNDS", 1000)
    db.init_db()


@pytest.fixture
def client():
    return TestClient(app)


class ApiUser:
    """A registered account plus a client that sends its bearer token."""

    def __init__(self, client: TestClient, username: str, password: str):
        self.client = client
        self.username = username
        self.password = password
        response = client.post(
            "/api/auth/register",
            json={"username": username, "password": password},
        )
        assert response.status_code == 201, response.text
        body = response.json()
        self.token = body["token"]
        self.id = body["user"]["id"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def get(self, url, **kwargs):
        return self.client.get(url, headers=self.headers, **kwargs)

    def post(self, url, **kwargs):
        return self.client.post(url, headers=self.headers, **kwargs)

    def patch(self, url, **kwargs):
        return self.client.patch(url, headers=self.headers, **kwargs)

    def delete(self, url, **kwargs):
        return self.client.delete(url, headers=self.headers, **kwargs)

    def create_board(self, name: str = "Board", template: str = "kanban") -> dict:
        response = self.post("/api/boards", json={"name": name, "template": template})
        assert response.status_code == 201, response.text
        return response.json()


@pytest.fixture
def alice(client):
    return ApiUser(client, "alice", "password123")


@pytest.fixture
def bob(client):
    return ApiUser(client, "bob", "password123")


@pytest.fixture
def board(alice):
    return alice.create_board("Roadmap")
