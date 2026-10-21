
import io

import pytest

from backend.app import create_app
from backend.app.extensions import db
from backend.app.models import User, Document, Permission


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


def create_account(client, email, role):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "name": "Permission Test",
            "email": email,
            "password": "StrongTestPass123!",
        },
    )
    assert response.status_code == 201

    with client.application.app_context():
        user = User.query.filter_by(email=email).first()
        user.role = role
        db.session.commit()

    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": email,
            "password": "StrongTestPass123!",
        },
    )
    assert response.status_code == 200
    return response.get_json()["access_token"]


def create_document(client, owner_token):
    response = client.post(
        "/api/v1/documents",
        headers={"Authorization": f"Bearer {owner_token}"},
        data={
            "title": "Shared Document",
            "category": "General",
            "file": (
                io.BytesIO(b"Private test document"),
                "shared.txt",
                "text/plain",
            ),
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 201
    return response.get_json()["document"]["id"]


def grant(client, owner_token, document_id, target_email, level="read"):
    return client.post(
        f"/api/v1/documents/{document_id}/permissions",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"email": target_email, "access_level": level},
    )


def test_owner_can_grant_read_permission(client):
    owner_token = create_account(client, "owner@example.com", "owner")
    create_account(client, "viewer@example.com", "viewer")
    document_id = create_document(client, owner_token)

    response = grant(
        client, owner_token, document_id, "viewer@example.com", "read"
    )

    assert response.status_code == 200
    assert response.get_json()["permission"]["access_level"] == "read"


def test_owner_can_grant_edit_permission(client):
    owner_token = create_account(client, "owner@example.com", "owner")
    create_account(client, "editor@example.com", "viewer")
    document_id = create_document(client, owner_token)

    response = grant(
        client, owner_token, document_id, "editor@example.com", "edit"
    )

    assert response.status_code == 200
    assert response.get_json()["permission"]["access_level"] == "edit"


def test_invalid_access_level_is_rejected(client):
    owner_token = create_account(client, "owner@example.com", "owner")
    create_account(client, "viewer@example.com", "viewer")
    document_id = create_document(client, owner_token)

    response = grant(
        client, owner_token, document_id, "viewer@example.com", "admin"
    )

    assert response.status_code == 400


def test_non_owner_cannot_grant_permission(client):
    first_owner = create_account(client, "first@example.com", "owner")
    second_owner = create_account(client, "second@example.com", "owner")
    create_account(client, "viewer@example.com", "viewer")
    document_id = create_document(client, first_owner)

    response = grant(
        client, second_owner, document_id, "viewer@example.com", "read"
    )

    assert response.status_code == 404


def test_owner_can_revoke_permission(client, app):
    owner_token = create_account(client, "owner@example.com", "owner")
    create_account(client, "viewer@example.com", "viewer")
    document_id = create_document(client, owner_token)

    grant(
        client, owner_token, document_id, "viewer@example.com", "read"
    )

    with app.app_context():
        viewer = User.query.filter_by(email="viewer@example.com").first()
        viewer_id = viewer.id

    response = client.delete(
        f"/api/v1/documents/{document_id}/permissions/{viewer_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    assert response.status_code == 200

    with app.app_context():
        permission = Permission.query.filter_by(
            document_id=document_id,
            user_id=viewer_id,
        ).first()
        assert permission is not None
        assert permission.is_active is False
        assert permission.revoked_at is not None


def test_revoking_missing_permission_returns_404(client):
    owner_token = create_account(client, "owner@example.com", "owner")
    document_id = create_document(client, owner_token)

    response = client.delete(
        f"/api/v1/documents/{document_id}/permissions/99999",
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    assert response.status_code == 404
