
import pytest
from flask import jsonify
from flask_jwt_extended import create_access_token

from backend.app import create_app
from backend.app.extensions import db
from backend.app.models import User
from backend.app.security.authorization import role_required


@pytest.fixture()
def app():
    app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite://",
    })

    @app.get("/api/v1/test/owner")
    @role_required("owner")
    def owner_only():
        return jsonify({"message": "Owner access granted"}), 200

    @app.get("/api/v1/test/admin")
    @role_required("admin")
    def admin_only():
        return jsonify({"message": "Admin access granted"}), 200

    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def create_user_token(app, role="viewer", is_active=True):
    with app.app_context():
        user = User(
            name="Authorization Test",
            email=f"{role}-{is_active}@example.com",
            role=role,
            is_active=is_active,
        )
        user.set_password("StrongTestPass123!")
        db.session.add(user)
        db.session.commit()

        token = create_access_token(identity=str(user.id))
        return token


def test_owner_role_can_access_owner_endpoint(client, app):
    token = create_user_token(app, role="owner")

    response = client.get(
        "/api/v1/test/owner",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200


def test_viewer_cannot_access_owner_endpoint(client, app):
    token = create_user_token(app, role="viewer")

    response = client.get(
        "/api/v1/test/owner",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403


def test_only_admin_can_access_admin_endpoint(client, app):
    token = create_user_token(app, role="owner")

    response = client.get(
        "/api/v1/test/admin",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403


def test_admin_can_access_admin_endpoint(client, app):
    token = create_user_token(app, role="admin")

    response = client.get(
        "/api/v1/test/admin",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200


def test_endpoint_rejects_request_without_token(client):
    response = client.get("/api/v1/test/owner")

    assert response.status_code == 401


def test_inactive_user_is_rejected(client, app):
    token = create_user_token(
        app,
        role="owner",
        is_active=False,
    )

    response = client.get(
        "/api/v1/test/owner",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401
