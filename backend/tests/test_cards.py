import pytest


@pytest.fixture
def columns(board):
    return [column["id"] for column in board["columns"]]


def add_card(user, board_id, column_id, title, **extra):
    response = user.post(
        f"/api/boards/{board_id}/cards",
        json={"column_id": column_id, "title": title, **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


def card_named(board, title):
    return next(card for card in board["cards"] if card["title"] == title)


def test_card_is_created_with_defaults(alice, board, columns):
    updated = add_card(alice, board["id"], columns[0], "Write the spec")
    card = updated["cards"][0]
    assert card["title"] == "Write the spec"
    assert card["priority"] == "medium"
    assert card["archived"] is False
    assert card["position"] == 0
    assert updated["columns"][0]["card_ids"] == [card["id"]]


def test_card_accepts_every_optional_field(alice, board, columns):
    label_id = board["labels"][0]["id"]
    updated = add_card(
        alice,
        board["id"],
        columns[0],
        "Full card",
        details="Everything set",
        priority="urgent",
        assignee_id=alice.id,
        due_date="2026-12-01",
        estimate=3.5,
        label_ids=[label_id],
    )
    card = updated["cards"][0]
    assert card["details"] == "Everything set"
    assert card["priority"] == "urgent"
    assert card["assignee_username"] == "alice"
    assert card["due_date"] == "2026-12-01"
    assert card["estimate"] == 3.5
    assert card["label_ids"] == [label_id]


def test_cards_are_positioned_in_creation_order(alice, board, columns):
    add_card(alice, board["id"], columns[0], "First")
    updated = add_card(alice, board["id"], columns[0], "Second")
    assert [card["position"] for card in updated["cards"]] == [0, 1]
    assert updated["columns"][0]["card_ids"] == [
        card_named(updated, "First")["id"],
        card_named(updated, "Second")["id"],
    ]


def test_card_create_rejects_a_column_from_another_board(alice, board):
    other = alice.create_board("Other")
    response = alice.post(
        f"/api/boards/{board['id']}/cards",
        json={"column_id": other["columns"][0]["id"], "title": "Wrong board"},
    )
    assert response.status_code == 404


def test_card_create_rejects_a_non_member_assignee(alice, bob, board, columns):
    response = alice.post(
        f"/api/boards/{board['id']}/cards",
        json={"column_id": columns[0], "title": "Task", "assignee_id": bob.id},
    )
    assert response.status_code == 400


def test_card_create_requires_a_title(alice, board, columns):
    response = alice.post(
        f"/api/boards/{board['id']}/cards", json={"column_id": columns[0], "title": ""}
    )
    assert response.status_code == 422


def test_card_detail_includes_comments(alice, board, columns):
    updated = add_card(alice, board["id"], columns[0], "Task")
    card_id = updated["cards"][0]["id"]
    alice.post(f"/api/cards/{card_id}/comments", json={"body": "Looks good"})

    detail = alice.get(f"/api/cards/{card_id}").json()
    assert detail["title"] == "Task"
    assert [comment["body"] for comment in detail["comments"]] == ["Looks good"]
    assert detail["comment_count"] == 1


def test_card_fields_can_be_updated(alice, board, columns):
    card_id = add_card(alice, board["id"], columns[0], "Task")["cards"][0]["id"]
    updated = alice.patch(
        f"/api/cards/{card_id}",
        json={
            "title": "Renamed",
            "details": "New details",
            "priority": "high",
            "due_date": "2026-11-30",
            "estimate": 2,
        },
    ).json()
    card = updated["cards"][0]
    assert card["title"] == "Renamed"
    assert card["details"] == "New details"
    assert card["priority"] == "high"
    assert card["due_date"] == "2026-11-30"
    assert card["estimate"] == 2


def test_optional_card_fields_can_be_cleared(alice, board, columns):
    card_id = add_card(
        alice,
        board["id"],
        columns[0],
        "Task",
        assignee_id=alice.id,
        due_date="2026-11-30",
        estimate=2,
    )["cards"][0]["id"]

    updated = alice.patch(
        f"/api/cards/{card_id}",
        json={"clear_assignee": True, "clear_due_date": True, "clear_estimate": True},
    ).json()
    card = updated["cards"][0]
    assert card["assignee_id"] is None
    assert card["due_date"] is None
    assert card["estimate"] is None


def test_card_labels_are_replaced_wholesale(alice, board, columns):
    first, second = board["labels"][0]["id"], board["labels"][1]["id"]
    card_id = add_card(
        alice, board["id"], columns[0], "Task", label_ids=[first]
    )["cards"][0]["id"]

    updated = alice.patch(f"/api/cards/{card_id}", json={"label_ids": [second]}).json()
    assert updated["cards"][0]["label_ids"] == [second]

    cleared = alice.patch(f"/api/cards/{card_id}", json={"label_ids": []}).json()
    assert cleared["cards"][0]["label_ids"] == []


def test_labels_from_another_board_are_ignored(alice, board, columns):
    other = alice.create_board("Other")
    foreign = other["labels"][0]["id"]
    updated = add_card(alice, board["id"], columns[0], "Task", label_ids=[foreign])
    assert updated["cards"][0]["label_ids"] == []


def test_archiving_a_card_hides_it_from_the_board(alice, board, columns):
    add_card(alice, board["id"], columns[0], "Keep")
    card_id = add_card(alice, board["id"], columns[0], "Hide")["cards"][1]["id"]

    updated = alice.patch(f"/api/cards/{card_id}", json={"archived": True}).json()
    assert [card["title"] for card in updated["cards"]] == ["Keep"]
    assert updated["columns"][0]["card_ids"] == [updated["cards"][0]["id"]]

    with_archived = alice.get(
        f"/api/boards/{board['id']}?include_archived=true"
    ).json()
    assert {card["title"] for card in with_archived["cards"]} == {"Keep", "Hide"}
    # An archived card still does not occupy a slot in its column.
    assert with_archived["columns"][0]["card_ids"] == [updated["cards"][0]["id"]]


def test_card_can_be_deleted(alice, board, columns):
    card_id = add_card(alice, board["id"], columns[0], "Task")["cards"][0]["id"]
    updated = alice.delete(f"/api/cards/{card_id}").json()
    assert updated["cards"] == []
    assert alice.get(f"/api/cards/{card_id}").status_code == 404


def test_deleting_a_card_renumbers_the_column(alice, board, columns):
    board_id = board["id"]
    add_card(alice, board_id, columns[0], "A")
    add_card(alice, board_id, columns[0], "B")
    updated = add_card(alice, board_id, columns[0], "C")

    middle = card_named(updated, "B")["id"]
    after = alice.delete(f"/api/cards/{middle}").json()
    assert [(card["title"], card["position"]) for card in after["cards"]] == [
        ("A", 0),
        ("C", 1),
    ]


def test_card_moves_to_another_column(alice, board, columns):
    card_id = add_card(alice, board["id"], columns[0], "Task")["cards"][0]["id"]
    updated = alice.post(
        f"/api/cards/{card_id}/move", json={"column_id": columns[1], "position": 0}
    ).json()
    assert updated["columns"][0]["card_ids"] == []
    assert updated["columns"][1]["card_ids"] == [card_id]
    assert updated["cards"][0]["column_id"] == columns[1]


def test_card_move_inserts_at_the_requested_position(alice, board, columns):
    board_id = board["id"]
    add_card(alice, board_id, columns[1], "Existing A")
    updated = add_card(alice, board_id, columns[1], "Existing B")
    moving = add_card(alice, board_id, columns[0], "Moving")
    moving_id = card_named(moving, "Moving")["id"]

    result = alice.post(
        f"/api/cards/{moving_id}/move", json={"column_id": columns[1], "position": 1}
    ).json()
    order = result["columns"][1]["card_ids"]
    assert order == [
        card_named(updated, "Existing A")["id"],
        moving_id,
        card_named(updated, "Existing B")["id"],
    ]


def test_card_can_be_reordered_inside_its_column(alice, board, columns):
    board_id = board["id"]
    add_card(alice, board_id, columns[0], "A")
    add_card(alice, board_id, columns[0], "B")
    updated = add_card(alice, board_id, columns[0], "C")
    last = card_named(updated, "C")["id"]

    result = alice.post(
        f"/api/cards/{last}/move", json={"column_id": columns[0], "position": 0}
    ).json()
    titles = [
        next(card for card in result["cards"] if card["id"] == card_id)["title"]
        for card_id in result["columns"][0]["card_ids"]
    ]
    assert titles == ["C", "A", "B"]


def test_card_move_past_the_end_clamps(alice, board, columns):
    board_id = board["id"]
    add_card(alice, board_id, columns[0], "A")
    updated = add_card(alice, board_id, columns[0], "B")
    first = card_named(updated, "A")["id"]

    result = alice.post(
        f"/api/cards/{first}/move", json={"column_id": columns[0], "position": 99}
    ).json()
    assert result["columns"][0]["card_ids"][-1] == first


def test_move_is_blocked_by_a_full_wip_limit(alice, board, columns):
    board_id = board["id"]
    alice.patch(f"/api/columns/{columns[1]}", json={"wip_limit": 1})
    add_card(alice, board_id, columns[1], "Occupier")
    updated = add_card(alice, board_id, columns[0], "Incoming")
    incoming = card_named(updated, "Incoming")["id"]

    response = alice.post(
        f"/api/cards/{incoming}/move", json={"column_id": columns[1], "position": 0}
    )
    assert response.status_code == 409
    assert "WIP limit" in response.json()["detail"]


def test_wip_limit_does_not_block_reordering_within_the_column(alice, board, columns):
    board_id = board["id"]
    alice.patch(f"/api/columns/{columns[0]}", json={"wip_limit": 2})
    add_card(alice, board_id, columns[0], "A")
    updated = add_card(alice, board_id, columns[0], "B")
    second = card_named(updated, "B")["id"]

    response = alice.post(
        f"/api/cards/{second}/move", json={"column_id": columns[0], "position": 0}
    )
    assert response.status_code == 200


def test_move_to_a_foreign_column_is_404(alice, board, columns):
    other = alice.create_board("Other")
    card_id = add_card(alice, board["id"], columns[0], "Task")["cards"][0]["id"]
    response = alice.post(
        f"/api/cards/{card_id}/move",
        json={"column_id": other["columns"][0]["id"], "position": 0},
    )
    assert response.status_code == 404


def test_deleting_a_column_removes_its_cards(alice, board, columns):
    add_card(alice, board["id"], columns[0], "Doomed")
    updated = alice.delete(f"/api/columns/{columns[0]}").json()
    assert updated["cards"] == []


def test_missing_card_is_404(alice):
    assert alice.get("/api/cards/9999").status_code == 404
    assert alice.patch("/api/cards/9999", json={"title": "X"}).status_code == 404
    assert alice.delete("/api/cards/9999").status_code == 404
