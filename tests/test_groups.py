import io

import pytest

from backend.app import create_app
from backend.app.extensions import db
from backend.app.models import User, Group, GroupMembership, GroupPermission


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


def create_user_and_token(client, email, role="viewer"):
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


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def upload_text_file(client, token):
    return client.post(
        "/api/v1/documents",
        headers=auth(token),
        data={
            "title": "Group Test Document",
            "category": "General",
            "file": (
                io.BytesIO(b"TrustVault group test"),
                "group-test.txt",
                "text/plain",
            ),
        },
        content_type="multipart/form-data",
    )


def test_viewer_cannot_create_group(client):
    token = create_user_and_token(client, "viewer@example.com", "viewer")

    response = client.post(
        "/api/v1/groups",
        headers=auth(token),
        json={"name": "Restricted Group"},
    )

    assert response.status_code == 403


def test_owner_can_create_list_update_and_delete_group(client):
    token = create_user_and_token(client, "owner@example.com", "owner")
    headers = auth(token)

    response = client.post(
        "/api/v1/groups",
        headers=headers,
        json={"name": "Engineering", "description": "Engineering team"},
    )
    assert response.status_code == 201
    group_id = response.get_json()["group"]["id"]

    response = client.get("/api/v1/groups", headers=headers)
    assert response.status_code == 200
    assert any(g["id"] == group_id for g in response.get_json()["groups"])

    response = client.patch(
        f"/api/v1/groups/{group_id}",
        headers=headers,
        json={"name": "Platform"},
    )
    assert response.status_code == 200
    assert response.get_json()["group"]["name"] == "Platform"

    response = client.delete(f"/api/v1/groups/{group_id}", headers=headers)
    assert response.status_code == 200


def test_owner_can_add_and_remove_group_member(client, app):
    owner_token = create_user_and_token(client, "owner2@example.com", "owner")
    member_token = create_user_and_token(client, "member@example.com", "viewer")
    headers = auth(owner_token)

    response = client.post(
        "/api/v1/groups",
        headers=headers,
        json={"name": "Reviewers"},
    )
    assert response.status_code == 201
    group_id = response.get_json()["group"]["id"]

    response = client.post(
        f"/api/v1/groups/{group_id}/members",
        headers=headers,
        json={"email": "member@example.com"},
    )
    assert response.status_code == 201

    response = client.get(
        f"/api/v1/groups/{group_id}/members",
        headers=headers,
    )
    assert response.status_code == 200
    assert any(m["email"] == "member@example.com"
               for m in response.get_json()["members"])

    with app.app_context():
        member = User.query.filter_by(email="member@example.com").first()
        assert GroupMembership.query.filter_by(
            group_id=group_id, user_id=member.id
        ).first() is not None

    response = client.delete(
        f"/api/v1/groups/{group_id}/members/{member.id}",
        headers=headers,
    )
    assert response.status_code == 200


def test_group_document_access_grant_and_revoke(client, app):
    owner_token = create_user_and_token(client, "docowner@example.com", "owner")
    member_token = create_user_and_token(client, "docmember@example.com", "viewer")
    owner_headers = auth(owner_token)
    member_headers = auth(member_token)

    upload_response = upload_text_file(client, owner_token)
    assert upload_response.status_code in (200, 201), upload_response.get_json()
    document_data = upload_response.get_json()
    document_id = document_data.get("document", {}).get("id", document_data.get("id"))
    assert document_id is not None, document_data

    group_response = client.post(
        "/api/v1/groups",
        headers=owner_headers,
        json={"name": "Document Readers"},
    )
    assert group_response.status_code == 201
    group_id = group_response.get_json()["group"]["id"]

    add_response = client.post(
        f"/api/v1/groups/{group_id}/members",
        headers=owner_headers,
        json={"email": "docmember@example.com"},
    )
    assert add_response.status_code == 201

    grant_response = client.post(
        f"/api/v1/groups/{group_id}/documents",
        headers=owner_headers,
        json={"document_id": document_id, "access_level": "read"},
    )
    assert grant_response.status_code == 200, grant_response.get_json()

    with app.app_context():
        member = User.query.filter_by(email="docmember@example.com").first()
        permission = GroupPermission.query.filter_by(
            group_id=group_id, document_id=document_id
        ).first()
        assert permission is not None and permission.is_active
        assert GroupMembership.query.filter_by(
            group_id=group_id, user_id=member.id
        ).first() is not None

    # Member should now be able to list shared documents.
    list_response = client.get("/api/v1/documents", headers=member_headers)
    assert list_response.status_code == 200

    revoke_response = client.delete(
        f"/api/v1/groups/{group_id}/documents/{document_id}",
        headers=owner_headers,
    )
    assert revoke_response.status_code == 200

    with app.app_context():
        permission = GroupPermission.query.filter_by(
            group_id=group_id, document_id=document_id
        ).first()
        assert permission is not None and not permission.is_active

def test_deleting_group_cleans_memberships_and_permissions(client, app):
    owner_token = create_user_and_token(
        client, "cleanup-owner@example.com", "owner"
    )
    member_token = create_user_and_token(
        client, "cleanup-member@example.com", "viewer"
    )
    headers = auth(owner_token)

    response = client.post(
        "/api/v1/groups",
        headers=headers,
        json={"name": "Cleanup Test Group"},
    )
    assert response.status_code == 201
    group_id = response.get_json()["group"]["id"]

    response = client.post(
        f"/api/v1/groups/{group_id}/members",
        headers=headers,
        json={"email": "cleanup-member@example.com"},
    )
    assert response.status_code == 201

    # Create a document using the owner account.
    upload_response = upload_text_file(client, owner_token)
    assert upload_response.status_code in (200, 201), upload_response.get_json()
    document_data = upload_response.get_json()
    document_id = document_data.get(
        "document", {}
    ).get("id", document_data.get("id"))
    assert document_id is not None, document_data

    response = client.post(
        f"/api/v1/groups/{group_id}/documents",
        headers=headers,
        json={"document_id": document_id, "access_level": "read"},
    )
    assert response.status_code == 200, response.get_json()

    response = client.delete(
        f"/api/v1/groups/{group_id}",
        headers=headers,
    )
    assert response.status_code == 200

    with app.app_context():
        assert Group.query.filter_by(id=group_id).first() is None
        assert GroupMembership.query.filter_by(
            group_id=group_id
        ).count() == 0
        assert GroupPermission.query.filter_by(
            group_id=group_id
        ).count() == 0


def test_removing_group_member_immediately_blocks_download(client):
    owner_token = create_user_and_token(
        client, "revoke-owner@example.com", "owner"
    )
    member_token = create_user_and_token(
        client, "revoke-member@example.com", "viewer"
    )
    owner_headers = auth(owner_token)
    member_headers = auth(member_token)

    upload_response = upload_text_file(client, owner_token)
    assert upload_response.status_code in (200, 201), upload_response.get_json()

    document_data = upload_response.get_json()
    document_id = document_data.get(
        "document", {}
    ).get("id", document_data.get("id"))
    assert document_id is not None, document_data

    group_response = client.post(
        "/api/v1/groups",
        headers=owner_headers,
        json={"name": "Immediate Revocation"},
    )
    assert group_response.status_code == 201
    group_id = group_response.get_json()["group"]["id"]

    add_response = client.post(
        f"/api/v1/groups/{group_id}/members",
        headers=owner_headers,
        json={"email": "revoke-member@example.com"},
    )
    assert add_response.status_code == 201

    grant_response = client.post(
        f"/api/v1/groups/{group_id}/documents",
        headers=owner_headers,
        json={"document_id": document_id, "access_level": "read"},
    )
    assert grant_response.status_code == 200, grant_response.get_json()

    download_url = f"/api/v1/documents/{document_id}/download"

    # Access works while membership and permission are active.
    allowed = client.get(download_url, headers=member_headers)
    assert allowed.status_code == 200, allowed.get_json()

    with client.application.app_context():
        from backend.app.models import User
        member = User.query.filter_by(
            email="revoke-member@example.com"
        ).first()
        member_id = member.id

    remove_response = client.delete(
        f"/api/v1/groups/{group_id}/members/{member_id}",
        headers=owner_headers,
    )
    assert remove_response.status_code == 200

    # Membership removal must block the next request immediately.
    denied = client.get(download_url, headers=member_headers)
    assert denied.status_code == 404

def test_revoking_group_document_permission_blocks_download(client):
    owner_token = create_user_and_token(
        client, "perm-owner@example.com", "owner"
    )
    member_token = create_user_and_token(
        client, "perm-member@example.com", "viewer"
    )
    owner_headers = auth(owner_token)
    member_headers = auth(member_token)

    upload_response = upload_text_file(client, owner_token)
    assert upload_response.status_code in (200, 201), upload_response.get_json()

    document_data = upload_response.get_json()
    document_id = document_data.get(
        "document", {}
    ).get("id", document_data.get("id"))
    assert document_id is not None, document_data

    response = client.post(
        "/api/v1/groups",
        headers=owner_headers,
        json={"name": "Permission Revocation"},
    )
    assert response.status_code == 201
    group_id = response.get_json()["group"]["id"]

    response = client.post(
        f"/api/v1/groups/{group_id}/members",
        headers=owner_headers,
        json={"email": "perm-member@example.com"},
    )
    assert response.status_code == 201

    response = client.post(
        f"/api/v1/groups/{group_id}/documents",
        headers=owner_headers,
        json={"document_id": document_id, "access_level": "read"},
    )
    assert response.status_code == 200, response.get_json()

    download_url = f"/api/v1/documents/{document_id}/download"

    allowed = client.get(download_url, headers=member_headers)
    assert allowed.status_code == 200, allowed.get_json()

    response = client.delete(
        f"/api/v1/groups/{group_id}/documents/{document_id}",
        headers=owner_headers,
    )
    assert response.status_code == 200, response.get_json()

    denied = client.get(download_url, headers=member_headers)
    assert denied.status_code == 404