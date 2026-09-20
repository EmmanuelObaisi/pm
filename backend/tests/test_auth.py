from app import config, db, repository
from app.security import create_access_token, hash_password, verify_password


def test_register_returns_token_and_seeds_a_board(client):
    response = client.post(
        "/api/auth/register",
        json={"username": "dana", "password": "password123", "email": "d@example.com"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["user"]["username"] == "dana"
    assert body["user"]["email"] == "d@example.com"
    assert body["token"]

    headers = {"Authorization": f"Bearer {body['token']}"}
    boards = client.get("/api/boards", headers=headers).json()
    assert len(boards) == 1
    assert boards[0]["name"] == "My First Board"


def test_first_registered_user_is_admin_and_later_ones_are_not(client):
    first = client.post(
        "/api/auth/register", json={"username": "first", "password": "password123"}
    ).json()
    second = client.post(
        "/api/auth/register", json={"username": "second", "password": "password123"}
    ).json()
    assert first["user"]["is_admin"] is True
    assert second["user"]["is_admin"] is False


def test_register_rejects_duplicate_username(client, alice):
    response = client.post(
        "/api/auth/register", json={"username": "alice", "password": "password123"}
    )
    assert response.status_code == 409


def test_register_rejects_short_password(client):
    response = client.post(
        "/api/auth/register", json={"username": "shorty", "password": "abc"}
    )
    assert response.status_code == 422


def test_login_succeeds_with_correct_password(client, alice):
    response = client.post(
        "/api/auth/login", json={"username": "alice", "password": "password123"}
    )
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "alice"


def test_login_rejects_wrong_password(client, alice):
    response = client.post(
        "/api/auth/login", json={"username": "alice", "password": "nope"}
    )
    assert response.status_code == 401


def test_login_rejects_unknown_user(client):
    response = client.post(
        "/api/auth/login", json={"username": "ghost", "password": "password123"}
    )
    assert response.status_code == 401


def test_protected_route_requires_a_token(client):
    assert client.get("/api/boards").status_code == 401


def test_protected_route_rejects_a_garbage_token(client):
    response = client.get("/api/boards", headers={"Authorization": "Bearer nonsense"})
    assert response.status_code == 401


def test_token_for_a_deleted_user_is_rejected(client, alice):
    token = create_access_token(9999, "ghost")
    response = client.get("/api/boards", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_me_returns_the_current_profile(alice):
    body = alice.get("/api/auth/me").json()
    assert body["username"] == "alice"
    assert "password_hash" not in body


def test_profile_can_be_updated(alice):
    body = alice.patch(
        "/api/auth/me", json={"full_name": "Alice A", "email": "alice@example.com"}
    ).json()
    assert body["full_name"] == "Alice A"
    assert body["email"] == "alice@example.com"


def test_password_change_then_login_with_the_new_password(client, alice):
    response = alice.post(
        "/api/auth/password",
        json={"current_password": "password123", "new_password": "brandnew123"},
    )
    assert response.status_code == 200

    assert (
        client.post(
            "/api/auth/login", json={"username": "alice", "password": "password123"}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/login", json={"username": "alice", "password": "brandnew123"}
        ).status_code
        == 200
    )


def test_password_change_rejects_a_wrong_current_password(alice):
    response = alice.post(
        "/api/auth/password",
        json={"current_password": "wrong", "new_password": "brandnew123"},
    )
    assert response.status_code == 400


def test_user_directory_lists_active_accounts(alice, bob):
    usernames = [user["username"] for user in alice.get("/api/auth/users").json()]
    assert usernames == ["alice", "bob"]


def test_admin_can_list_and_deactivate_users(client, alice, bob):
    users = alice.get("/api/admin/users").json()
    assert {user["username"] for user in users} == {"alice", "bob"}

    updated = alice.patch(f"/api/admin/users/{bob.id}", json={"is_active": False}).json()
    assert updated["is_active"] is False

    assert bob.get("/api/boards").status_code == 403
    assert (
        client.post(
            "/api/auth/login", json={"username": "bob", "password": "password123"}
        ).status_code
        == 403
    )


def test_admin_can_promote_another_user(alice, bob):
    updated = alice.patch(f"/api/admin/users/{bob.id}", json={"is_admin": True}).json()
    assert updated["is_admin"] is True
    assert bob.get("/api/admin/users").status_code == 200


def test_admin_cannot_demote_themselves(alice):
    assert (
        alice.patch(f"/api/admin/users/{alice.id}", json={"is_admin": False}).status_code
        == 400
    )
    assert (
        alice.patch(f"/api/admin/users/{alice.id}", json={"is_active": False}).status_code
        == 400
    )


def test_admin_update_of_a_missing_user_is_404(alice):
    assert alice.patch("/api/admin/users/9999", json={"is_admin": True}).status_code == 404


def test_non_admin_cannot_reach_the_admin_routes(alice, bob):
    # alice registered first, so bob is an ordinary account.
    assert bob.get("/api/admin/users").status_code == 403


def test_password_hash_round_trips_and_rejects_tampering():
    stored = hash_password("secret123")
    assert stored.startswith("pbkdf2_sha256$")
    assert verify_password("secret123", stored)
    assert not verify_password("secret124", stored)
    assert not verify_password("secret123", "garbage")
    assert not verify_password("secret123", "md5$1$2$3")


def test_two_hashes_of_one_password_differ_by_salt():
    assert hash_password("secret123") != hash_password("secret123")


def test_expired_token_is_rejected(monkeypatch, client, alice):
    monkeypatch.setattr(config, "TOKEN_TTL_HOURS", -1)
    token = create_access_token(alice.id, "alice")
    response = client.get("/api/boards", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_ensure_demo_user_seeds_once():
    with db.connect() as connection:
        user = repository.ensure_demo_user(connection)
        assert user["username"] == "user"
        assert user["is_admin"] == 1
        assert repository.ensure_demo_user(connection) is None
        assert len(repository.list_users(connection)) == 1
