
import pytest

from backend.app import create_app
from backend.app.extensions import db
from backend.app.models import User


@pytest.fixture()
def app():
    app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite://",
    })

    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def register_user(client, **overrides):
    data = {
        "name": "Test User",
        "email": "test@example.com",
        "password": "StrongTestPass123!",
    }
    data.update(overrides)
    return client.post("/api/v1/auth/register", json=data)


def test_registration_success(client, app):
    response = register_user(client)

    assert response.status_code == 201
    body = response.get_json()
    assert body["user"]["role"] == "viewer"
    assert "password_hash" not in body["user"]

    with app.app_context():
        user = User.query.filter_by(email="test@example.com").first()
        assert user.check_password("StrongTestPass123!")
        assert user.password_hash != "StrongTestPass123!"


def test_registration_cannot_assign_admin_role(client):
    response = register_user(
        client,
        email="admin-attempt@example.com",
        role="admin",
    )
    assert response.status_code == 201
    assert response.get_json()["user"]["role"] == "viewer"


def test_registration_cannot_assign_owner_role(client):
    response = register_user(
        client,
        email="owner-attempt@example.com",
        role="owner",
    )
    assert response.status_code == 201
    assert response.get_json()["user"]["role"] == "viewer"


def test_duplicate_email_is_rejected(client):
    assert register_user(client).status_code == 201
    response = register_user(
        client,
        name="Another User",
        email="TEST@example.com",
    )
    assert response.status_code == 409


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"name": "", "email": "test@example.com",
         "password": "StrongTestPass123!"},
        {"name": "Test", "email": "invalid-email",
         "password": "StrongTestPass123!"},
        {"name": "Test", "email": "test@example.com",
         "password": "short"},
    ],
)
def test_invalid_registration_is_rejected(client, payload):
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 400


def test_non_json_registration_is_rejected(client):
    response = client.post(
        "/api/v1/auth/register",
        data="not json",
        content_type="text/plain",
    )
    assert response.status_code == 400


def test_login_returns_jwt_token(client):
    assert register_user(client).status_code == 201

    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "test@example.com",
            "password": "StrongTestPass123!",
        },
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["token_type"] == "Bearer"
    assert isinstance(body["access_token"], str)
    assert body["access_token"]
    assert body["user"]["role"] == "viewer"
    assert "password_hash" not in body["user"]


def test_login_rejects_wrong_password(client):
    register_user(client)
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "test@example.com",
            "password": "WrongPassword123!",
        },
    )
    assert response.status_code == 401


def test_login_rejects_unknown_email(client):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "unknown@example.com",
            "password": "StrongTestPass123!",
        },
    )
    assert response.status_code == 401


def test_login_rejects_inactive_account(client, app):
    register_user(client)

    with app.app_context():
        user = User.query.filter_by(email="test@example.com").first()
        user.is_active = False
        db.session.commit()

    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "test@example.com",
            "password": "StrongTestPass123!",
        },
    )
    assert response.status_code == 403


def test_login_rejects_missing_fields(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com"},
    )
    assert response.status_code == 400
