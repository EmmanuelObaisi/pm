import json

import httpx
import pytest

from app import ai
from tests.test_cards import add_card, card_named


class FakeResponse:
    def __init__(self, payload, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.text = text or json.dumps(payload)

    def json(self):
        if self._payload is None:
            raise json.JSONDecodeError("no json", "", 0)
        return self._payload


def stub_openrouter(monkeypatch, reply="Done", operations=None, capture=None):
    """Make httpx.post return one structured assistant response."""
    content = json.dumps({"reply": reply, "operations": operations or []})

    def fake_post(url, **kwargs):
        if capture is not None:
            capture.update(kwargs)
        return FakeResponse({"choices": [{"message": {"content": content}}]})

    monkeypatch.setattr(httpx, "post", fake_post)


@pytest.fixture(autouse=True)
def api_key(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")


def test_a_question_with_no_operations_leaves_the_board_alone(monkeypatch, alice, board):
    stub_openrouter(monkeypatch, reply="You have no cards yet.")
    response = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Summarize"})

    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "You have no cards yet."
    assert body["applied"] == []
    assert body["errors"] == []
    assert body["board"]["cards"] == []


def operation(op, **fields):
    """Build an operation with every field present, as the schema requires."""
    base = {name: None for name in ai.OPERATION_FIELDS}
    base["op"] = op
    base.update(fields)
    return base


def test_create_card_operation_is_applied(monkeypatch, alice, board):
    column_id = board["columns"][0]["id"]
    stub_openrouter(
        monkeypatch,
        reply="Added it.",
        operations=[
            operation(
                "create_card",
                column_id=column_id,
                title="Ship the API",
                details="Write the docs too",
                priority="high",
                due_date="2026-12-24",
                assignee="alice",
            )
        ],
    )

    body = alice.post(
        f"/api/boards/{board['id']}/ai", json={"question": "Add a card"}
    ).json()
    assert len(body["applied"]) == 1
    card = body["board"]["cards"][0]
    assert card["title"] == "Ship the API"
    assert card["priority"] == "high"
    assert card["due_date"] == "2026-12-24"
    assert card["assignee_username"] == "alice"


def test_update_move_and_comment_operations(monkeypatch, alice, board):
    columns = [column["id"] for column in board["columns"]]
    card_id = add_card(alice, board["id"], columns[0], "Draft")["cards"][0]["id"]

    stub_openrouter(
        monkeypatch,
        operations=[
            operation("update_card", card_id=card_id, title="Final", priority="urgent"),
            operation("move_card", card_id=card_id, column_id=columns[2], position=0),
            operation("add_comment", card_id=card_id, body="Moved to review"),
        ],
    )

    body = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Go"}).json()
    assert len(body["applied"]) == 3
    assert body["errors"] == []

    card = body["board"]["cards"][0]
    assert card["title"] == "Final"
    assert card["priority"] == "urgent"
    assert card["column_id"] == columns[2]
    assert card["comment_count"] == 1


def test_delete_and_archive_operations(monkeypatch, alice, board):
    column_id = board["columns"][0]["id"]
    created = add_card(alice, board["id"], column_id, "Gone")
    add_card(alice, board["id"], column_id, "Hidden")
    gone = card_named(created, "Gone")["id"]
    hidden = alice.get(f"/api/boards/{board['id']}").json()["cards"][1]["id"]

    stub_openrouter(
        monkeypatch,
        operations=[
            operation("delete_card", card_id=gone),
            operation("archive_card", card_id=hidden),
        ],
    )

    body = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Clean up"}).json()
    assert len(body["applied"]) == 2
    assert body["board"]["cards"] == []


def test_column_operations(monkeypatch, alice, board):
    columns = [column["id"] for column in board["columns"]]
    stub_openrouter(
        monkeypatch,
        operations=[
            operation("create_column", title="Blocked"),
            operation("rename_column", column_id=columns[0], title="Inbox"),
            operation("delete_column", column_id=columns[3]),
        ],
    )

    body = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Reshape"}).json()
    titles = [column["title"] for column in body["board"]["columns"]]
    assert titles == ["Inbox", "In Progress", "Review", "Blocked"]


def test_a_bad_operation_is_reported_without_losing_the_good_ones(
    monkeypatch, alice, board
):
    column_id = board["columns"][0]["id"]
    stub_openrouter(
        monkeypatch,
        operations=[
            operation("create_card", column_id=column_id, title="Real card"),
            operation("update_card", card_id=4242, title="Ghost"),
            operation("create_card", column_id=9999, title="Wrong column"),
            operation("teleport_card", card_id=1),
            "not an object",
        ],
    )

    body = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Mixed"}).json()
    assert len(body["applied"]) == 1
    assert len(body["errors"]) == 4
    assert [card["title"] for card in body["board"]["cards"]] == ["Real card"]


def test_operations_that_are_missing_required_fields_are_rejected(
    monkeypatch, alice, board
):
    column_id = board["columns"][0]["id"]
    card_id = add_card(alice, board["id"], column_id, "Task")["cards"][0]["id"]
    stub_openrouter(
        monkeypatch,
        operations=[
            operation("create_card", column_id=column_id, title="   "),
            operation("create_column", title=""),
            operation("update_card", card_id=card_id),
            operation("add_comment", card_id=card_id, body=""),
            operation("delete_card"),
        ],
    )

    body = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Bad"}).json()
    assert body["applied"] == []
    assert len(body["errors"]) == 5


def test_assigning_a_non_member_is_an_operation_error(monkeypatch, alice, bob, board):
    column_id = board["columns"][0]["id"]
    stub_openrouter(
        monkeypatch,
        operations=[
            operation("create_card", column_id=column_id, title="Task", assignee="bob")
        ],
    )

    body = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Assign"}).json()
    assert body["applied"] == []
    assert "bob is not a member" in body["errors"][0]


def test_a_card_from_another_board_cannot_be_touched(monkeypatch, alice, board):
    other = alice.create_board("Other")
    foreign = add_card(alice, other["id"], other["columns"][0]["id"], "Theirs")["cards"][0]
    stub_openrouter(
        monkeypatch, operations=[operation("delete_card", card_id=foreign["id"])]
    )

    body = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Delete"}).json()
    assert body["applied"] == []
    assert "not on this board" in body["errors"][0]
    assert alice.get(f"/api/cards/{foreign['id']}").status_code == 200


def test_applied_operations_are_written_to_the_activity_feed(monkeypatch, alice, board):
    column_id = board["columns"][0]["id"]
    stub_openrouter(
        monkeypatch,
        operations=[operation("create_card", column_id=column_id, title="Tracked")],
    )
    alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Add"})

    activity = alice.get(f"/api/boards/{board['id']}/activity").json()
    assert activity[0]["action"] == "ai.operation"
    assert "created card Tracked" in activity[0]["summary"]


def test_conversation_history_is_persisted_and_replayed(monkeypatch, alice, board):
    board_id = board["id"]
    stub_openrouter(monkeypatch, reply="First answer")
    alice.post(f"/api/boards/{board_id}/ai", json={"question": "First question"})

    capture: dict = {}
    stub_openrouter(monkeypatch, reply="Second answer", capture=capture)
    alice.post(f"/api/boards/{board_id}/ai", json={"question": "Second question"})

    sent = capture["json"]["messages"]
    assert sent[0]["role"] == "system"
    assert [message["content"] for message in sent[1:]] == [
        "First question",
        "First answer",
        "Second question",
    ]

    stored = alice.get(f"/api/boards/{board_id}/ai/messages").json()
    assert [(item["role"], item["content"]) for item in stored] == [
        ("user", "First question"),
        ("assistant", "First answer"),
        ("user", "Second question"),
        ("assistant", "Second answer"),
    ]


def test_history_can_be_cleared(monkeypatch, alice, board):
    stub_openrouter(monkeypatch)
    alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Hello"})

    assert alice.delete(f"/api/boards/{board['id']}/ai/messages").status_code == 204
    assert alice.get(f"/api/boards/{board['id']}/ai/messages").json() == []


def test_the_prompt_carries_the_board_state(monkeypatch, alice, board):
    column_id = board["columns"][0]["id"]
    add_card(alice, board["id"], column_id, "Visible to the model")

    capture: dict = {}
    stub_openrouter(monkeypatch, capture=capture)
    alice.post(f"/api/boards/{board['id']}/ai", json={"question": "What is on the board?"})

    system = capture["json"]["messages"][0]["content"]
    assert "Visible to the model" in system
    assert capture["json"]["model"] == "openai/gpt-oss-120b"
    assert capture["json"]["response_format"]["json_schema"]["strict"] is True


def test_a_viewer_cannot_use_the_assistant(monkeypatch, alice, bob, board):
    alice.post(
        f"/api/boards/{board['id']}/members", json={"username": "bob", "role": "viewer"}
    )
    stub_openrouter(monkeypatch)

    assert bob.post(f"/api/boards/{board['id']}/ai", json={"question": "Hi"}).status_code == 403
    assert bob.get(f"/api/boards/{board['id']}/ai/messages").status_code == 200


def test_a_non_member_cannot_use_the_assistant(monkeypatch, bob, board):
    stub_openrouter(monkeypatch)
    assert bob.post(f"/api/boards/{board['id']}/ai", json={"question": "Hi"}).status_code == 404


def test_a_missing_api_key_is_reported(monkeypatch, alice, board):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    response = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Hi"})
    assert response.status_code == 500
    assert "OPENROUTER_API_KEY" in response.json()["detail"]


def test_a_transport_failure_becomes_a_502(monkeypatch, alice, board):
    def fail(url, **kwargs):
        raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(httpx, "post", fail)
    response = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Hi"})
    assert response.status_code == 502


def test_an_error_status_from_openrouter_becomes_a_502(monkeypatch, alice, board):
    monkeypatch.setattr(
        httpx, "post", lambda url, **kwargs: FakeResponse({}, 429, "rate limited")
    )
    response = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Hi"})
    assert response.status_code == 502
    assert "429" in response.json()["detail"]


def test_an_unexpected_response_shape_becomes_a_502(monkeypatch, alice, board):
    monkeypatch.setattr(httpx, "post", lambda url, **kwargs: FakeResponse({"oops": True}))
    response = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Hi"})
    assert response.status_code == 502


def test_non_json_content_becomes_a_502(monkeypatch, alice, board):
    monkeypatch.setattr(
        httpx,
        "post",
        lambda url, **kwargs: FakeResponse({"choices": [{"message": {"content": "hi"}}]}),
    )
    response = alice.post(f"/api/boards/{board['id']}/ai", json={"question": "Hi"})
    assert response.status_code == 502
    assert "not valid JSON" in response.json()["detail"]


def test_the_connectivity_endpoint_passes_the_prompt_through(monkeypatch, alice):
    monkeypatch.setattr(
        httpx,
        "post",
        lambda url, **kwargs: FakeResponse(
            {"choices": [{"message": {"content": "  pong  "}}]}
        ),
    )
    response = alice.post("/api/ai/test", json={"prompt": "ping"})
    assert response.json() == {"answer": "pong"}


def test_the_connectivity_endpoint_needs_a_token(client):
    assert client.post("/api/ai/test", json={"prompt": "ping"}).status_code == 401
