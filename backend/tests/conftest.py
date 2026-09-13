import pytest

from app import main


@pytest.fixture(autouse=True)
def isolate_database(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "test.db")
