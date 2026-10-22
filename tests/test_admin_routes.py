
import pytest
from uuid import uuid4
from flask_jwt_extended import create_access_token

from backend.app import create_app
from backend.app.extensions import db
from backend.app.models import User, AuditLog


@pytest.fixture()
def app():
    test_app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite://",
    })

    with test_app.app_context():
        db.create_all()
        yield test_app
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def create_user_token(app, role="admin", is_active=True):
    with app.app_context():
        user = User(
            name=f"Test {role}",
            email=f"test-{role}-{is_active}-{uuid4().hex}@example.com",
            role=role,
            is_active=is_active,
        )
        user.set_password("StrongTestPass123!")
        db.session.add(user)
        db.session.commit()

        return create_access_token(identity=str(user.id)), user.id


def test_admin_users_requires_authentication(client):
    response = client.get("/api/v1/admin/users")
    assert response.status_code == 401


def test_viewer_cannot_list_users(client, app):
    token, _ = create_user_token(app, role="viewer")

    response = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403


def test_admin_can_list_users(client, app):
    token, _ = create_user_token(app)

    response = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    data = response.get_json()
    assert "users" in data
    assert data["count"] >= 1


def test_promotion_requires_authentication(client, app):
    _, target_id = create_user_token(app, role="viewer")

    response = client.patch(
        f"/api/v1/admin/users/{target_id}/role",
        json={"role": "owner"},
    )

    assert response.status_code == 401


def test_viewer_cannot_promote_users(client, app):
    token, _ = create_user_token(app, role="viewer")
    _, target_id = create_user_token(app, role="viewer")

    response = client.patch(
        f"/api/v1/admin/users/{target_id}/role",
        headers={"Authorization": f"Bearer {token}"},
        json={"role": "owner"},
    )

    assert response.status_code == 403


def test_admin_can_promote_viewer_and_audit_it(client, app):
    admin_token, admin_id = create_user_token(app, role="admin")
    _, target_id = create_user_token(app, role="viewer")

    response = client.patch(
        f"/api/v1/admin/users/{target_id}/role",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"role": "owner"},
    )

    assert response.status_code == 200
    assert response.get_json()["user"]["role"] == "owner"

    with app.app_context():
        target = db.session.get(User, target_id)
        assert target.role == "owner"

        audit = db.session.query(AuditLog).filter_by(
            action="role_promoted",
            resource_id=target_id,
        ).one()

        assert audit.actor_id == admin_id
        assert audit.outcome == "success"
        assert audit.details["previous_role"] == "viewer"
        assert audit.details["new_role"] == "owner"


def test_promotion_of_missing_user_returns_404(client, app):
    token, _ = create_user_token(app, role="admin")

    response = client.patch(
        "/api/v1/admin/users/9999/role",
        headers={"Authorization": f"Bearer {token}"},
        json={"role": "owner"},
    )

    assert response.status_code == 404


def test_invalid_promotion_role_returns_400(client, app):
    token, _ = create_user_token(app, role="admin")
    _, target_id = create_user_token(app, role="viewer")

    response = client.patch(
        f"/api/v1/admin/users/{target_id}/role",
        headers={"Authorization": f"Bearer {token}"},
        json={"role": "admin"},
    )

    assert response.status_code == 400


def test_already_owner_promotion_is_idempotent(client, app):
    token, _ = create_user_token(app, role="admin")
    _, target_id = create_user_token(app, role="owner")

    response = client.patch(
        f"/api/v1/admin/users/{target_id}/role",
        headers={"Authorization": f"Bearer {token}"},
        json={"role": "owner"},
    )

    assert response.status_code == 200
    assert response.get_json()["user"]["role"] == "owner"


def test_admin_cannot_promote_another_admin(client, app):
    token, _ = create_user_token(app, role="admin")
    _, target_id = create_user_token(app, role="admin")

    response = client.patch(
        f"/api/v1/admin/users/{target_id}/role",
        headers={"Authorization": f"Bearer {token}"},
        json={"role": "owner"},
    )

    assert response.status_code == 409
