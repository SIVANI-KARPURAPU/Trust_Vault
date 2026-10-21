
import io
from pathlib import Path

import pytest

from backend.app import create_app
from backend.app.extensions import db
from backend.app.models import User, Permission, Document


@pytest.fixture()
def app(tmp_path):
    app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite://",
        "MAX_CONTENT_LENGTH": 10 * 1024 * 1024,
    })

    app.config["TEST_UPLOAD_DIR"] = str(tmp_path)

    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def create_user_and_token(client, email, role):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "name": "Test User",
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


def upload_text_file(client, token, filename="sample.txt"):
    return client.post(
        "/api/v1/documents",
        headers={"Authorization": f"Bearer {token}"},
        data={
            "title": "Sample Document",
            "category": "General",
            "file": (
                io.BytesIO(b"TrustVault test document"),
                filename,
                "text/plain",
            ),
        },
        content_type="multipart/form-data",
    )


def grant_permission(
    app, document_id, owner_email, viewer_email, access_level="read"
):
    with app.app_context():
        owner = User.query.filter_by(email=owner_email).first()
        viewer = User.query.filter_by(email=viewer_email).first()

        permission = Permission(
            document_id=document_id,
            user_id=viewer.id,
            access_level=access_level,
            is_active=True,
            granted_by=owner.id,
        )
        db.session.add(permission)
        db.session.commit()
        return viewer.id


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_documents_endpoint_requires_token(client):
    response = client.get("/api/v1/documents")
    assert response.status_code == 401


def test_viewer_cannot_upload_documents(client):
    token = create_user_and_token(client, "viewer@example.com", "viewer")
    response = upload_text_file(client, token)
    assert response.status_code == 403


def test_owner_can_upload_allowed_file(client):
    token = create_user_and_token(client, "owner@example.com", "owner")
    response = upload_text_file(client, token)

    assert response.status_code == 201
    assert response.get_json()["document"]["original_filename"] == "sample.txt"


def test_owner_can_list_own_documents(client):
    token = create_user_and_token(client, "list-owner@example.com", "owner")
    assert upload_text_file(client, token).status_code == 201

    response = client.get("/api/v1/documents", headers=auth(token))
    assert response.status_code == 200
    assert len(response.get_json()["documents"]) == 1


def test_disallowed_extension_is_rejected(client):
    token = create_user_and_token(client, "invalid-owner@example.com", "owner")

    response = client.post(
        "/api/v1/documents",
        headers=auth(token),
        data={
            "title": "Bad File",
            "category": "General",
            "file": (
                io.BytesIO(b"not an executable"),
                "payload.exe",
                "application/octet-stream",
            ),
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 415


def test_owner_cannot_see_another_owners_documents(client):
    first = create_user_and_token(client, "first-owner@example.com", "owner")
    second = create_user_and_token(client, "second-owner@example.com", "owner")

    assert upload_text_file(client, first).status_code == 201

    response = client.get("/api/v1/documents", headers=auth(second))
    assert response.status_code == 200
    assert response.get_json()["documents"] == []


def test_shared_viewer_can_download_document(client, app):
    owner_token = create_user_and_token(
        client, "download-owner@example.com", "owner"
    )
    viewer_token = create_user_and_token(
        client, "download-viewer@example.com", "viewer"
    )

    upload = upload_text_file(client, owner_token)
    assert upload.status_code == 201
    document_id = upload.get_json()["document"]["id"]

    grant_permission(
        app, document_id,
        "download-owner@example.com", "download-viewer@example.com"
    )

    response = client.get(
        f"/api/v1/documents/{document_id}/download",
        headers=auth(viewer_token),
    )
    assert response.status_code == 200
    assert response.data == b"TrustVault test document"


def test_revoked_viewer_cannot_download_document(client, app):
    owner_token = create_user_and_token(
        client, "revoke-owner@example.com", "owner"
    )
    viewer_token = create_user_and_token(
        client, "revoke-viewer@example.com", "viewer"
    )

    upload = upload_text_file(client, owner_token)
    assert upload.status_code == 201
    document_id = upload.get_json()["document"]["id"]

    viewer_id = grant_permission(
        app, document_id,
        "revoke-owner@example.com", "revoke-viewer@example.com"
    )

    before = client.get(
        f"/api/v1/documents/{document_id}/download",
        headers=auth(viewer_token),
    )
    assert before.status_code == 200

    revoke = client.delete(
        f"/api/v1/documents/{document_id}/permissions/{viewer_id}",
        headers=auth(owner_token),
    )
    assert revoke.status_code == 200

    after = client.get(
        f"/api/v1/documents/{document_id}/download",
        headers=auth(viewer_token),
    )
    assert after.status_code == 404


def test_unshared_user_cannot_download_document(client):
    owner_token = create_user_and_token(
        client, "private-owner@example.com", "owner"
    )
    stranger_token = create_user_and_token(
        client, "stranger@example.com", "viewer"
    )

    upload = upload_text_file(client, owner_token)
    assert upload.status_code == 201
    document_id = upload.get_json()["document"]["id"]

    response = client.get(
        f"/api/v1/documents/{document_id}/download",
        headers=auth(stranger_token),
    )
    assert response.status_code == 404


def test_owner_can_edit_document(client):
    token = create_user_and_token(client, "edit-owner@example.com", "owner")
    upload = upload_text_file(client, token)
    document_id = upload.get_json()["document"]["id"]

    response = client.patch(
        f"/api/v1/documents/{document_id}",
        headers=auth(token),
        json={"title": "Updated Title", "category": "Reports"},
    )

    assert response.status_code == 200
    assert response.get_json()["document"]["title"] == "Updated Title"
    assert response.get_json()["document"]["category"] == "Reports"


def test_viewer_with_edit_permission_can_edit(client, app):
    owner_token = create_user_and_token(
        client, "editor-owner@example.com", "owner"
    )
    editor_token = create_user_and_token(
        client, "editor-viewer@example.com", "viewer"
    )

    upload = upload_text_file(client, owner_token)
    document_id = upload.get_json()["document"]["id"]

    grant_permission(
        app, document_id,
        "editor-owner@example.com", "editor-viewer@example.com",
        access_level="edit",
    )

    response = client.patch(
        f"/api/v1/documents/{document_id}",
        headers=auth(editor_token),
        json={"title": "Editor Updated Title"},
    )

    assert response.status_code == 200
    assert response.get_json()["document"]["title"] == "Editor Updated Title"


def test_viewer_with_read_permission_cannot_edit(client, app):
    owner_token = create_user_and_token(
        client, "reader-owner@example.com", "owner"
    )
    reader_token = create_user_and_token(
        client, "reader-viewer@example.com", "viewer"
    )

    upload = upload_text_file(client, owner_token)
    document_id = upload.get_json()["document"]["id"]

    grant_permission(
        app, document_id,
        "reader-owner@example.com", "reader-viewer@example.com",
        access_level="read",
    )

    response = client.patch(
        f"/api/v1/documents/{document_id}",
        headers=auth(reader_token),
        json={"title": "Unauthorized Change"},
    )

    assert response.status_code == 404


def test_unshared_user_cannot_edit_document(client):
    owner_token = create_user_and_token(
        client, "edit-private-owner@example.com", "owner"
    )
    stranger_token = create_user_and_token(
        client, "edit-stranger@example.com", "viewer"
    )

    upload = upload_text_file(client, owner_token)
    document_id = upload.get_json()["document"]["id"]

    response = client.patch(
        f"/api/v1/documents/{document_id}",
        headers=auth(stranger_token),
        json={"title": "Unauthorized Change"},
    )

    assert response.status_code == 404


def test_non_owner_cannot_delete_document(client, app):
    owner_token = create_user_and_token(
        client, "delete-owner@example.com", "owner"
    )
    viewer_token = create_user_and_token(
        client, "delete-viewer@example.com", "viewer"
    )

    upload = upload_text_file(client, owner_token)
    document_id = upload.get_json()["document"]["id"]

    grant_permission(
        app, document_id,
        "delete-owner@example.com", "delete-viewer@example.com",
        access_level="edit",
    )

    response = client.delete(
        f"/api/v1/documents/{document_id}",
        headers=auth(viewer_token),
    )

    assert response.status_code == 404

    with app.app_context():
        assert db.session.get(Document, document_id) is not None


def test_owner_can_delete_document_and_file(client, app):
    owner_token = create_user_and_token(
        client, "real-delete-owner@example.com", "owner"
    )

    upload = upload_text_file(client, owner_token)
    assert upload.status_code == 201
    document_id = upload.get_json()["document"]["id"]

    with app.app_context():
        document = db.session.get(Document, document_id)
        file_path = (
            Path(app.instance_path) / "private_uploads" / document.storage_key
        )
        assert file_path.is_file()

    response = client.delete(
        f"/api/v1/documents/{document_id}",
        headers=auth(owner_token),
    )

    assert response.status_code == 200

    with app.app_context():
        assert db.session.get(Document, document_id) is None

    assert not file_path.exists()


def test_edit_rejects_unknown_fields(client):
    token = create_user_and_token(
        client, "fields-owner@example.com", "owner"
    )
    upload = upload_text_file(client, token)
    document_id = upload.get_json()["document"]["id"]

    response = client.patch(
        f"/api/v1/documents/{document_id}",
        headers=auth(token),
        json={"owner_id": 999},
    )

    assert response.status_code == 400
def test_fake_pdf_content_is_rejected(client):
    token = create_user_and_token(
        client, "fake-pdf-owner@example.com", "owner"
    )

    response = client.post(
        "/api/v1/documents",
        headers=auth(token),
        data={
            "title": "Fake PDF",
            "category": "General",
            "file": (
                io.BytesIO(b"This is plain text, not a PDF"),
                "fake.pdf",
                "application/pdf",
            ),
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 415


def test_fake_png_content_is_rejected(client):
    token = create_user_and_token(
        client, "fake-png-owner@example.com", "owner"
    )

    response = client.post(
        "/api/v1/documents",
        headers=auth(token),
        data={
            "title": "Fake PNG",
            "category": "General",
            "file": (
                io.BytesIO(b"This is not a PNG image"),
                "fake.png",
                "image/png",
            ),
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 415


def test_invalid_utf8_text_file_is_rejected(client):
    token = create_user_and_token(
        client, "invalid-text-owner@example.com", "owner"
    )

    response = client.post(
        "/api/v1/documents",
        headers=auth(token),
        data={
            "title": "Invalid Text",
            "category": "General",
            "file": (
                io.BytesIO(b"\xff\xfe\xfa"),
                "invalid.txt",
                "text/plain",
            ),
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 415