def test_new_board_uses_the_kanban_template(alice):
    board = alice.create_board("Roadmap")
    assert board["name"] == "Roadmap"
    assert board["role"] == "owner"
    assert [column["title"] for column in board["columns"]] == [
        "Backlog",
        "In Progress",
        "Review",
        "Done",
    ]
    assert [label["name"] for label in board["labels"]] == ["Bug", "Feature", "Chore"]
    assert board["cards"] == []
    assert board["members"][0]["role"] == "owner"


def test_empty_template_has_no_columns_or_labels(alice):
    board = alice.create_board("Blank", template="empty")
    assert board["columns"] == []
    assert board["labels"] == []


def test_board_list_covers_every_board_the_user_can_see(alice):
    alice.create_board("One")
    alice.create_board("Two")
    boards = alice.get("/api/boards").json()
    # "My First Board" comes from registration.
    assert {board["name"] for board in boards} == {"My First Board", "One", "Two"}


def test_archived_boards_are_hidden_unless_requested(alice, board):
    alice.patch(f"/api/boards/{board['id']}", json={"archived": True})

    visible = [item["name"] for item in alice.get("/api/boards").json()]
    assert "Roadmap" not in visible

    everything = [
        item["name"] for item in alice.get("/api/boards?include_archived=true").json()
    ]
    assert "Roadmap" in everything


def test_board_can_be_renamed_and_described(alice, board):
    updated = alice.patch(
        f"/api/boards/{board['id']}", json={"name": "Q3 Roadmap", "description": "Plan"}
    ).json()
    assert updated["name"] == "Q3 Roadmap"
    assert updated["description"] == "Plan"


def test_board_delete_removes_it_from_the_list(alice, board):
    assert alice.delete(f"/api/boards/{board['id']}").status_code == 204
    assert alice.get(f"/api/boards/{board['id']}").status_code == 404


def test_deleting_a_board_cascades_to_its_cards(alice, board):
    column_id = board["columns"][0]["id"]
    alice.post(
        f"/api/boards/{board['id']}/cards", json={"column_id": column_id, "title": "Task"}
    )
    alice.delete(f"/api/boards/{board['id']}")

    from app import db

    with db.connect() as connection:
        remaining = connection.execute(
            "SELECT COUNT(*) AS total FROM cards WHERE board_id = ?", (board["id"],)
        ).fetchone()["total"]
    assert remaining == 0


def test_a_stranger_cannot_see_someone_elses_board(bob, board):
    assert bob.get(f"/api/boards/{board['id']}").status_code == 404


def test_missing_board_is_404(alice):
    assert alice.get("/api/boards/9999").status_code == 404


def test_board_create_requires_a_name(alice):
    assert alice.post("/api/boards", json={"name": ""}).status_code == 422


def test_activity_records_board_creation(alice, board):
    activity = alice.get(f"/api/boards/{board['id']}/activity").json()
    assert activity[-1]["action"] == "board.create"
    assert activity[-1]["username"] == "alice"


def test_activity_is_newest_first_and_respects_the_limit(alice, board):
    column_id = board["columns"][0]["id"]
    for index in range(5):
        alice.post(
            f"/api/boards/{board['id']}/cards",
            json={"column_id": column_id, "title": f"Card {index}"},
        )

    activity = alice.get(f"/api/boards/{board['id']}/activity?limit=3").json()
    assert len(activity) == 3
    assert activity[0]["summary"] == "created card Card 4"


# --------------------------------------------------------------------------
# Columns
# --------------------------------------------------------------------------


def test_column_is_appended_at_the_end(alice, board):
    updated = alice.post(
        f"/api/boards/{board['id']}/columns", json={"title": "Blocked"}
    ).json()
    assert [column["title"] for column in updated["columns"]][-1] == "Blocked"
    assert updated["columns"][-1]["position"] == 4


def test_column_can_be_renamed_and_given_a_wip_limit(alice, board):
    column_id = board["columns"][0]["id"]
    updated = alice.patch(
        f"/api/columns/{column_id}", json={"title": "Inbox", "wip_limit": 3}
    ).json()
    column = next(item for item in updated["columns"] if item["id"] == column_id)
    assert column["title"] == "Inbox"
    assert column["wip_limit"] == 3


def test_wip_limit_can_be_cleared(alice, board):
    column_id = board["columns"][0]["id"]
    alice.patch(f"/api/columns/{column_id}", json={"wip_limit": 3})
    updated = alice.patch(
        f"/api/columns/{column_id}", json={"clear_wip_limit": True}
    ).json()
    column = next(item for item in updated["columns"] if item["id"] == column_id)
    assert column["wip_limit"] is None


def test_deleting_a_column_renumbers_the_rest(alice, board):
    column_id = board["columns"][1]["id"]
    updated = alice.delete(f"/api/columns/{column_id}").json()
    assert [column["title"] for column in updated["columns"]] == [
        "Backlog",
        "Review",
        "Done",
    ]
    assert [column["position"] for column in updated["columns"]] == [0, 1, 2]


def test_column_can_be_moved_to_a_new_position(alice, board):
    last = board["columns"][3]["id"]
    updated = alice.post(f"/api/columns/{last}/move", json={"position": 0}).json()
    assert [column["title"] for column in updated["columns"]] == [
        "Done",
        "Backlog",
        "In Progress",
        "Review",
    ]
    assert [column["position"] for column in updated["columns"]] == [0, 1, 2, 3]


def test_moving_a_column_past_the_end_clamps_to_last(alice, board):
    first = board["columns"][0]["id"]
    updated = alice.post(f"/api/columns/{first}/move", json={"position": 99}).json()
    assert [column["title"] for column in updated["columns"]][-1] == "Backlog"


def test_column_routes_reject_a_non_member(bob, board):
    column_id = board["columns"][0]["id"]
    assert bob.patch(f"/api/columns/{column_id}", json={"title": "X"}).status_code == 404
    assert bob.delete(f"/api/columns/{column_id}").status_code == 404


def test_missing_column_is_404(alice):
    assert alice.patch("/api/columns/9999", json={"title": "X"}).status_code == 404


# --------------------------------------------------------------------------
# Labels
# --------------------------------------------------------------------------


def test_label_can_be_created_updated_and_deleted(alice, board):
    board_id = board["id"]
    created = alice.post(
        f"/api/boards/{board_id}/labels", json={"name": "Urgent", "color": "#ff0000"}
    ).json()
    label = created["labels"][-1]
    assert label["name"] == "Urgent"
    assert label["color"] == "#ff0000"

    updated = alice.patch(
        f"/api/boards/{board_id}/labels/{label['id']}", json={"name": "Critical"}
    ).json()
    assert updated["labels"][-1]["name"] == "Critical"

    remaining = alice.delete(f"/api/boards/{board_id}/labels/{label['id']}").json()
    assert all(item["id"] != label["id"] for item in remaining["labels"])


def test_a_label_from_another_board_is_404(alice, board):
    other = alice.create_board("Other")
    foreign_label = other["labels"][0]["id"]
    response = alice.patch(
        f"/api/boards/{board['id']}/labels/{foreign_label}", json={"name": "Nope"}
    )
    assert response.status_code == 404


def test_deleting_a_label_detaches_it_from_cards(alice, board):
    board_id = board["id"]
    label_id = board["labels"][0]["id"]
    column_id = board["columns"][0]["id"]
    created = alice.post(
        f"/api/boards/{board_id}/cards",
        json={"column_id": column_id, "title": "Task", "label_ids": [label_id]},
    ).json()
    assert created["cards"][0]["label_ids"] == [label_id]

    after = alice.delete(f"/api/boards/{board_id}/labels/{label_id}").json()
    assert after["cards"][0]["label_ids"] == []
