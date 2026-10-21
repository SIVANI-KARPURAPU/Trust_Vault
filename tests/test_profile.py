
import pytest

from backend.app import create_app
from backend.app.extensions import db


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


def create_user_and_login(client):
    registration = client.post(
        "/api/v1/auth/register",
        json={
            "name": "Profile Test",
            "email": "profile-test@example.com",
            "password": "StrongTestPass123!",
        },
    )
    assert registration.status_code == 201

    login = client.post(
        "/api/v1/auth/login",
        json={
            "email": "profile-test@example.com",
            "password": "StrongTestPass123!",
        },
    )
    assert login.status_code == 200
    return login.get_json()["access_token"]


def test_profile_requires_token(client):
    response = client.get("/api/v1/me")

    assert response.status_code == 401


def test_profile_accepts_valid_token(client):
    token = create_user_and_login(client)

    response = client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["user"]["email"] == "profile-test@example.com"
    assert body["user"]["role"] == "viewer"
    assert "password_hash" not in body["user"]


def test_profile_rejects_invalid_token(client):
    response = client.get(
        "/api/v1/me",
        headers={"Authorization": "Bearer invalid-token"},
    )

    assert response.status_code == 422
