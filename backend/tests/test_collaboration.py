import pytest

from tests.test_cards import add_card


@pytest.fixture
def shared(alice, bob, board):
    """A board alice owns with bob added as an editor."""
    response = alice.post(
        f"/api/boards/{board['id']}/members", json={"username": "bob", "role": "editor"}
    )
    assert response.status_code == 201
    return board


@pytest.fixture
def viewer_board(alice, bob, board):
    alice.post(
        f"/api/boards/{board['id']}/members", json={"username": "bob", "role": "viewer"}
    )
    return board


# --------------------------------------------------------------------------
# Membership
# --------------------------------------------------------------------------


def test_member_gains_access_to_the_board(bob, shared):
    assert bob.get(f"/api/boards/{shared['id']}").json()["role"] == "editor"
    assert any(item["id"] == shared["id"] for item in bob.get("/api/boards").json())


def test_members_are_listed_owner_first(alice, shared):
    members = alice.get(f"/api/boards/{shared['id']}/members").json()
    assert [member["username"] for member in members] == ["alice", "bob"]
    assert [member["role"] for member in members] == ["owner", "editor"]


def test_member_role_can_be_changed(alice, bob, shared):
    alice.patch(
        f"/api/boards/{shared['id']}/members/{bob.id}", json={"role": "viewer"}
    )
    assert bob.get(f"/api/boards/{shared['id']}").json()["role"] == "viewer"


def test_member_can_be_removed(alice, bob, shared):
    alice.delete(f"/api/boards/{shared['id']}/members/{bob.id}")
    assert bob.get(f"/api/boards/{shared['id']}").status_code == 404


def test_adding_an_unknown_user_is_404(alice, board):
    response = alice.post(
        f"/api/boards/{board['id']}/members", json={"username": "ghost"}
    )
    assert response.status_code == 404


def test_owner_cannot_add_themselves(alice, board):
    response = alice.post(
        f"/api/boards/{board['id']}/members", json={"username": "alice"}
    )
    assert response.status_code == 400


def test_owner_role_is_fixed_and_the_owner_cannot_be_removed(alice, board):
    board_id = board["id"]
    assert (
        alice.patch(
            f"/api/boards/{board_id}/members/{alice.id}", json={"role": "viewer"}
        ).status_code
        == 400
    )
    assert alice.delete(f"/api/boards/{board_id}/members/{alice.id}").status_code == 400


def test_changing_a_non_member_is_404(alice, bob, board):
    assert (
        alice.patch(
            f"/api/boards/{board['id']}/members/{bob.id}", json={"role": "viewer"}
        ).status_code
        == 404
    )
    assert alice.delete(f"/api/boards/{board['id']}/members/{bob.id}").status_code == 404


def test_re_adding_a_member_updates_their_role(alice, bob, shared):
    alice.post(
        f"/api/boards/{shared['id']}/members", json={"username": "bob", "role": "viewer"}
    )
    members = alice.get(f"/api/boards/{shared['id']}/members").json()
    assert len(members) == 2
    assert members[1]["role"] == "viewer"


# --------------------------------------------------------------------------
# Role enforcement
# --------------------------------------------------------------------------


def test_editor_can_change_content_but_not_board_settings(bob, shared):
    board_id = shared["id"]
    column_id = shared["columns"][0]["id"]

    assert (
        bob.post(
            f"/api/boards/{board_id}/cards",
            json={"column_id": column_id, "title": "From bob"},
        ).status_code
        == 201
    )
    assert bob.patch(f"/api/boards/{board_id}", json={"name": "Hijack"}).status_code == 403
    assert bob.delete(f"/api/boards/{board_id}").status_code == 403
    assert (
        bob.post(
            f"/api/boards/{board_id}/members", json={"username": "alice"}
        ).status_code
        == 403
    )


def test_viewer_can_read_but_not_write(alice, bob, viewer_board):
    board_id = viewer_board["id"]
    column_id = viewer_board["columns"][0]["id"]
    card_id = add_card(alice, board_id, column_id, "Task")["cards"][0]["id"]

    assert bob.get(f"/api/boards/{board_id}").status_code == 200
    assert bob.get(f"/api/cards/{card_id}").status_code == 200
    assert bob.get(f"/api/boards/{board_id}/activity").status_code == 200

    assert (
        bob.post(
            f"/api/boards/{board_id}/cards",
            json={"column_id": column_id, "title": "Nope"},
        ).status_code
        == 403
    )
    assert bob.patch(f"/api/cards/{card_id}", json={"title": "Nope"}).status_code == 403
    assert bob.delete(f"/api/cards/{card_id}").status_code == 403
    assert (
        bob.post(
            f"/api/cards/{card_id}/move", json={"column_id": column_id, "position": 0}
        ).status_code
        == 403
    )
    assert (
        bob.post(f"/api/boards/{board_id}/columns", json={"title": "Nope"}).status_code
        == 403
    )
    assert (
        bob.post(f"/api/boards/{board_id}/labels", json={"name": "Nope"}).status_code
        == 403
    )


def test_a_member_can_be_assigned_a_card(alice, bob, shared):
    column_id = shared["columns"][0]["id"]
    updated = add_card(alice, shared["id"], column_id, "Task", assignee_id=bob.id)
    assert updated["cards"][0]["assignee_username"] == "bob"


def test_assigning_a_removed_member_fails(alice, bob, shared):
    column_id = shared["columns"][0]["id"]
    card_id = add_card(alice, shared["id"], column_id, "Task")["cards"][0]["id"]
    alice.delete(f"/api/boards/{shared['id']}/members/{bob.id}")

    response = alice.patch(f"/api/cards/{card_id}", json={"assignee_id": bob.id})
    assert response.status_code == 400


# --------------------------------------------------------------------------
# Comments
# --------------------------------------------------------------------------


def test_comments_are_listed_in_order_with_their_author(alice, bob, shared):
    column_id = shared["columns"][0]["id"]
    card_id = add_card(alice, shared["id"], column_id, "Task")["cards"][0]["id"]

    alice.post(f"/api/cards/{card_id}/comments", json={"body": "First"})
    comments = bob.post(f"/api/cards/{card_id}/comments", json={"body": "Second"}).json()

    assert [(item["username"], item["body"]) for item in comments] == [
        ("alice", "First"),
        ("bob", "Second"),
    ]


def test_comment_count_appears_on_the_board(alice, shared):
    column_id = shared["columns"][0]["id"]
    card_id = add_card(alice, shared["id"], column_id, "Task")["cards"][0]["id"]
    alice.post(f"/api/cards/{card_id}/comments", json={"body": "Note"})

    board = alice.get(f"/api/boards/{shared['id']}").json()
    assert board["cards"][0]["comment_count"] == 1


def test_an_author_can_delete_their_own_comment(bob, alice, shared):
    column_id = shared["columns"][0]["id"]
    card_id = add_card(alice, shared["id"], column_id, "Task")["cards"][0]["id"]
    comment_id = bob.post(
        f"/api/cards/{card_id}/comments", json={"body": "Mine"}
    ).json()[0]["id"]

    assert bob.delete(f"/api/comments/{comment_id}").json() == []


def test_the_board_owner_can_delete_any_comment(alice, bob, shared):
    column_id = shared["columns"][0]["id"]
    card_id = add_card(alice, shared["id"], column_id, "Task")["cards"][0]["id"]
    comment_id = bob.post(
        f"/api/cards/{card_id}/comments", json={"body": "Bob's"}
    ).json()[0]["id"]

    assert alice.delete(f"/api/comments/{comment_id}").json() == []


def test_an_editor_cannot_delete_someone_elses_comment(alice, bob, shared):
    column_id = shared["columns"][0]["id"]
    card_id = add_card(alice, shared["id"], column_id, "Task")["cards"][0]["id"]
    comment_id = alice.post(
        f"/api/cards/{card_id}/comments", json={"body": "Alice's"}
    ).json()[0]["id"]

    assert bob.delete(f"/api/comments/{comment_id}").status_code == 403


def test_missing_comment_is_404(alice):
    assert alice.delete("/api/comments/9999").status_code == 404


def test_empty_comment_is_rejected(alice, board):
    column_id = board["columns"][0]["id"]
    card_id = add_card(alice, board["id"], column_id, "Task")["cards"][0]["id"]
    assert alice.post(f"/api/cards/{card_id}/comments", json={"body": ""}).status_code == 422


# --------------------------------------------------------------------------
# Checklists
# --------------------------------------------------------------------------


def test_checklist_items_track_progress(alice, board):
    column_id = board["columns"][0]["id"]
    card_id = add_card(alice, board["id"], column_id, "Task")["cards"][0]["id"]

    alice.post(f"/api/cards/{card_id}/checklist", json={"text": "Step one"})
    updated = alice.post(
        f"/api/cards/{card_id}/checklist", json={"text": "Step two"}
    ).json()
    card = updated["cards"][0]
    assert [item["text"] for item in card["checklist"]] == ["Step one", "Step two"]
    assert card["checklist_total"] == 2
    assert card["checklist_done"] == 0

    item_id = card["checklist"][0]["id"]
    done = alice.patch(f"/api/checklist/{item_id}", json={"done": True}).json()
    assert done["cards"][0]["checklist_done"] == 1


def test_checklist_item_text_can_be_edited_and_deleted(alice, board):
    column_id = board["columns"][0]["id"]
    card_id = add_card(alice, board["id"], column_id, "Task")["cards"][0]["id"]
    created = alice.post(
        f"/api/cards/{card_id}/checklist", json={"text": "Draft"}
    ).json()
    item_id = created["cards"][0]["checklist"][0]["id"]

    renamed = alice.patch(f"/api/checklist/{item_id}", json={"text": "Final"}).json()
    assert renamed["cards"][0]["checklist"][0]["text"] == "Final"

    removed = alice.delete(f"/api/checklist/{item_id}").json()
    assert removed["cards"][0]["checklist"] == []


def test_deleting_a_card_removes_its_checklist_and_comments(alice, board):
    from app import db

    column_id = board["columns"][0]["id"]
    card_id = add_card(alice, board["id"], column_id, "Task")["cards"][0]["id"]
    alice.post(f"/api/cards/{card_id}/checklist", json={"text": "Step"})
    alice.post(f"/api/cards/{card_id}/comments", json={"body": "Note"})
    alice.delete(f"/api/cards/{card_id}")

    with db.connect() as connection:
        items = connection.execute(
            "SELECT COUNT(*) AS total FROM checklist_items WHERE card_id = ?", (card_id,)
        ).fetchone()["total"]
        comments = connection.execute(
            "SELECT COUNT(*) AS total FROM comments WHERE card_id = ?", (card_id,)
        ).fetchone()["total"]
    assert items == 0
    assert comments == 0


def test_a_viewer_cannot_touch_the_checklist(alice, bob, viewer_board):
    column_id = viewer_board["columns"][0]["id"]
    card_id = add_card(alice, viewer_board["id"], column_id, "Task")["cards"][0]["id"]
    created = alice.post(
        f"/api/cards/{card_id}/checklist", json={"text": "Step"}
    ).json()
    item_id = created["cards"][0]["checklist"][0]["id"]

    assert (
        bob.post(f"/api/cards/{card_id}/checklist", json={"text": "Nope"}).status_code
        == 403
    )
    assert bob.patch(f"/api/checklist/{item_id}", json={"done": True}).status_code == 403
    assert bob.delete(f"/api/checklist/{item_id}").status_code == 403


def test_missing_checklist_item_is_404(alice):
    assert alice.patch("/api/checklist/9999", json={"done": True}).status_code == 404
    assert alice.delete("/api/checklist/9999").status_code == 404


# --------------------------------------------------------------------------
# Stats
# --------------------------------------------------------------------------


def test_stats_summarize_the_board(alice, bob, shared):
    board_id = shared["id"]
    columns = [column["id"] for column in shared["columns"]]

    add_card(alice, board_id, columns[0], "A", priority="high", estimate=2)
    add_card(alice, board_id, columns[0], "B", priority="high", estimate=3)
    add_card(alice, board_id, columns[1], "C", priority="low", assignee_id=bob.id)
    archived = add_card(alice, board_id, columns[1], "D")
    alice.patch(
        f"/api/cards/{[c for c in archived['cards'] if c['title'] == 'D'][0]['id']}",
        json={"archived": True},
    )

    stats = alice.get(f"/api/boards/{board_id}/stats").json()
    assert stats["total_cards"] == 4
    assert stats["active_cards"] == 3
    assert stats["archived_cards"] == 1
    assert stats["cards_by_priority"] == {"high": 2, "low": 1}
    assert stats["cards_by_column"] == {str(columns[0]): 2, str(columns[1]): 1}
    assert stats["cards_by_assignee"] == {"unassigned": 2, "bob": 1}
    assert stats["total_estimate"] == 5


def test_stats_count_overdue_cards(alice, board):
    board_id = board["id"]
    column_id = board["columns"][0]["id"]
    add_card(alice, board_id, column_id, "Late", due_date="2020-01-01")
    add_card(alice, board_id, column_id, "Future", due_date="2099-01-01")
    add_card(alice, board_id, column_id, "No date")

    stats = alice.get(f"/api/boards/{board_id}/stats").json()
    assert stats["overdue_cards"] == 1


def test_board_list_carries_per_board_stats(alice, board):
    add_card(alice, board["id"], board["columns"][0]["id"], "Task")
    entry = next(
        item for item in alice.get("/api/boards").json() if item["id"] == board["id"]
    )
    assert entry["stats"]["active_cards"] == 1
