
import pytest
from flask_jwt_extended import create_access_token

from backend.app import create_app
from backend.app.extensions import db
from backend.app.models import User


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


def create_audit_test_token(app, role="admin", is_active=True):
    with app.app_context():
        user = User(
            name="Audit Test User",
            email=f"audit-{role}-{is_active}@example.com",
            role=role,
            is_active=is_active,
        )
        user.set_password("StrongTestPass123!")
        db.session.add(user)
        db.session.commit()

        return create_access_token(identity=str(user.id))


def test_audit_logs_requires_authentication(client):
    response = client.get("/api/v1/admin/audit-logs")
    assert response.status_code == 401


def test_non_admin_cannot_view_audit_logs(client, app):
    token = create_audit_test_token(app, role="owner")
    response = client.get(
        "/api/v1/admin/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403


def test_admin_can_view_audit_logs(client, app):
    token = create_audit_test_token(app)
    response = client.get(
        "/api/v1/admin/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.get_json()
    assert "logs" in data
    assert "pagination" in data


def test_audit_logs_pagination_validation(client, app):
    token = create_audit_test_token(app)
    response = client.get(
        "/api/v1/admin/audit-logs?per_page=101",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400


def test_admin_can_verify_empty_audit_chain(client, app):
    token = create_audit_test_token(app)
    response = client.get(
        "/api/v1/admin/audit-logs/verify",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.get_json()["valid"] is True


def test_non_admin_cannot_verify_audit_chain(client, app):
    token = create_audit_test_token(app, role="viewer")
    response = client.get(
        "/api/v1/admin/audit-logs/verify",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
