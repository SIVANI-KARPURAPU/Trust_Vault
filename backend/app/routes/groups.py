from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import (
    Document,
    Group,
    GroupMembership,
    GroupPermission,
    User,
)
from ..services.audit_service import record_audit

groups_bp = Blueprint("groups", __name__)


def active_user():
    try:
        user_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return None

    user = db.session.get(User, user_id)
    return user if user and user.is_active else None


def audit(actor_id, action, resource_type, resource_id, outcome, details=None):
    record_audit(
        actor_id=actor_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        outcome=outcome,
        ip_address=request.remote_addr,
        details=details or {},
    )


def group_dict(group):
    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "owner_id": group.owner_id,
        "created_at": group.created_at.isoformat(),
    }


def owned_group(group_id, user):
    return db.session.scalar(
        select(Group).where(
            Group.id == group_id,
            Group.owner_id == user.id,
        )
    )


def fail(error, status):
    return jsonify({"error": error}), status


@groups_bp.route("/groups", methods=["GET", "POST"])
@jwt_required()
def groups_collection():
    user = active_user()
    if user is None:
        return fail("Account not found or inactive.", 401)

    if request.method == "GET":
        groups = db.session.scalars(
            select(Group)
            .where(Group.owner_id == user.id)
            .order_by(Group.created_at.desc())
        ).all()
        return jsonify({"groups": [group_dict(g) for g in groups]}), 200

    if user.role != "owner":
        audit(user.id, "group.create", "group", None, "denied",
              {"reason": "owner_role_required"})
        db.session.commit()
        return fail("Only owners can create groups.", 403)

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return fail("A JSON request body is required.", 400)

    name = data.get("name")
    description = data.get("description", "")

    if (
        not isinstance(name, str) or not name.strip()
        or len(name.strip()) > 120
        or not isinstance(description, str)
        or len(description) > 500
    ):
        return fail("Valid name (1-120 chars) and description (max 500 chars) are required.", 400)

    group = Group(
        name=name.strip(),
        description=description.strip(),
        owner_id=user.id,
    )
    db.session.add(group)

    try:
        db.session.flush()
        audit(user.id, "group.create", "group", group.id, "success",
              {"name": group.name})
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return fail("A group with this name already exists.", 409)
    except Exception:
        db.session.rollback()
        return fail("Group creation failed.", 500)

    return jsonify({"message": "Group created.", "group": group_dict(group)}), 201


@groups_bp.route("/groups/<int:group_id>", methods=["PATCH", "DELETE"])
@jwt_required()
def group_detail(group_id):
    user = active_user()
    if user is None:
        return fail("Account not found or inactive.", 401)

    group = owned_group(group_id, user)
    if group is None or user.role != "owner":
        audit(user.id, "group.manage", "group", group_id, "denied",
              {"reason": "not_owner_or_not_found"})
        db.session.commit()
        return fail("Group not found.", 404)

    if request.method == "PATCH":
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or not data:
            return fail("A non-empty JSON body is required.", 400)
        if not set(data).issubset({"name", "description"}):
            return fail("Only name and description can be changed.", 400)

        name = data.get("name", group.name)
        description = data.get("description", group.description)
        if (
            not isinstance(name, str) or not name.strip()
            or len(name.strip()) > 120
            or not isinstance(description, str)
            or len(description) > 500
        ):
            return fail("Invalid name or description.", 400)

        group.name = name.strip()
        group.description = description.strip()
        try:
            audit(user.id, "group.update", "group", group.id, "success",
                  {"name": group.name})
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return fail("A group with this name already exists.", 409)
        except Exception:
            db.session.rollback()
            return fail("Group update failed.", 500)

        return jsonify({"message": "Group updated.", "group": group_dict(group)}), 200

    try:
        audit(user.id, "group.delete", "group", group.id, "success",
              {"name": group.name})

        db.session.execute(
            db.delete(GroupMembership).where(
                GroupMembership.group_id == group.id
            )
        )
        db.session.execute(
            db.delete(GroupPermission).where(
                GroupPermission.group_id == group.id
            )
        )
        db.session.delete(group)
        db.session.commit()
    except Exception:
        db.session.rollback()
        return fail("Group deletion failed.", 500)

    return jsonify({"message": "Group deleted."}), 200


@groups_bp.route("/groups/<int:group_id>/members", methods=["GET", "POST"])
@jwt_required()
def group_members(group_id):
    user = active_user()
    if user is None:
        return fail("Account not found or inactive.", 401)

    group = owned_group(group_id, user)
    if group is None or user.role != "owner":
        audit(user.id, "group.members.manage", "group", group_id, "denied",
              {"reason": "not_owner_or_not_found"})
        db.session.commit()
        return fail("Group not found.", 404)

    if request.method == "GET":
        memberships = db.session.scalars(
            select(GroupMembership).where(GroupMembership.group_id == group.id)
        ).all()
        return jsonify({
            "members": [{
                "user_id": m.user.id,
                "name": m.user.name,
                "email": m.user.email,
                "added_at": m.created_at.isoformat(),
            } for m in memberships]
        }), 200

    data = request.get_json(silent=True)
    email = data.get("email") if isinstance(data, dict) else None
    if not isinstance(email, str) or not email.strip():
        return fail("A member email is required.", 400)

    target = db.session.scalar(
        select(User).where(
            User.email == email.strip().lower(),
            User.is_active.is_(True),
        )
    )
    if target is None:
        return fail("Active user not found.", 404)
    if target.id == group.owner_id:
        return fail("The group owner is already a group owner.", 400)

    membership = db.session.scalar(
        select(GroupMembership).where(
            GroupMembership.group_id == group.id,
            GroupMembership.user_id == target.id,
        )
    )
    if membership:
        return fail("User is already a member.", 409)

    membership = GroupMembership(
        group_id=group.id,
        user_id=target.id,
        added_by=user.id,
    )
    db.session.add(membership)

    try:
        db.session.flush()
        audit(user.id, "group.member.add", "group", group.id, "success",
              {"member_user_id": target.id})
        db.session.commit()
    except Exception:
        db.session.rollback()
        return fail("Adding group member failed.", 500)

    return jsonify({"message": "Member added.", "user_id": target.id}), 201


@groups_bp.delete("/groups/<int:group_id>/members/<int:target_user_id>")
@jwt_required()
def remove_group_member(group_id, target_user_id):
    user = active_user()
    if user is None:
        return fail("Account not found or inactive.", 401)

    group = owned_group(group_id, user)
    if group is None or user.role != "owner":
        audit(user.id, "group.member.remove", "group", group_id, "denied",
              {"reason": "not_owner_or_not_found"})
        db.session.commit()
        return fail("Group not found.", 404)

    membership = db.session.scalar(
        select(GroupMembership).where(
            GroupMembership.group_id == group.id,
            GroupMembership.user_id == target_user_id,
        )
    )
    if membership is None:
        return fail("Group member not found.", 404)

    try:
        db.session.delete(membership)
        audit(user.id, "group.member.remove", "group", group.id, "success",
              {"member_user_id": target_user_id})
        db.session.commit()
    except Exception:
        db.session.rollback()
        return fail("Removing group member failed.", 500)

    return jsonify({"message": "Member removed."}), 200


@groups_bp.route("/groups/<int:group_id>/documents", methods=["GET", "POST"])
@jwt_required()
def group_documents(group_id):
    user = active_user()
    if user is None:
        return fail("Account not found or inactive.", 401)

    group = owned_group(group_id, user)
    if group is None or user.role != "owner":
        audit(user.id, "group.document.manage", "group", group_id, "denied",
              {"reason": "not_owner_or_not_found"})
        db.session.commit()
        return fail("Group not found.", 404)

    if request.method == "GET":
        permissions = db.session.scalars(
            select(GroupPermission).where(GroupPermission.group_id == group.id)
        ).all()
        return jsonify({"documents": [{
            "document_id": p.document_id,
            "title": p.document.title,
            "access_level": p.access_level,
            "is_active": p.is_active,
        } for p in permissions]}), 200

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return fail("A JSON request body is required.", 400)

    document_id = data.get("document_id")
    access_level = data.get("access_level")
    if (
        not isinstance(document_id, int) or isinstance(document_id, bool)
        or access_level not in ("read", "edit")
    ):
        return fail("document_id and access_level (read/edit) are required.", 400)

    document = db.session.scalar(
        select(Document).where(
            Document.id == document_id,
            Document.owner_id == user.id,
        )
    )
    if document is None:
        return fail("Document not found.", 404)

    permission = db.session.scalar(
        select(GroupPermission).where(
            GroupPermission.group_id == group.id,
            GroupPermission.document_id == document.id,
        )
    )

    try:
        if permission is None:
            permission = GroupPermission(
                group_id=group.id,
                document_id=document.id,
                access_level=access_level,
                granted_by=user.id,
                is_active=True,
            )
            db.session.add(permission)
        else:
            permission.access_level = access_level
            permission.granted_by = user.id
            permission.is_active = True
            permission.revoked_at = None

        db.session.flush()
        audit(user.id, "group.document.grant", "document", document.id, "success",
              {"group_id": group.id, "access_level": access_level})
        db.session.commit()
    except Exception:
        db.session.rollback()
        return fail("Granting group document access failed.", 500)

    return jsonify({
        "message": "Group document access granted.",
        "document_id": document.id,
        "group_id": group.id,
        "access_level": access_level,
    }), 200


@groups_bp.delete("/groups/<int:group_id>/documents/<int:document_id>")
@jwt_required()
def revoke_group_document(group_id, document_id):
    user = active_user()
    if user is None:
        return fail("Account not found or inactive.", 401)

    group = owned_group(group_id, user)
    if group is None or user.role != "owner":
        audit(user.id, "group.document.revoke", "document", document_id, "denied",
              {"reason": "not_owner_or_not_found", "group_id": group_id})
        db.session.commit()
        return fail("Group not found.", 404)

    permission = db.session.scalar(
        select(GroupPermission).where(
            GroupPermission.group_id == group.id,
            GroupPermission.document_id == document_id,
            GroupPermission.is_active.is_(True),
        )
    )
    if permission is None:
        return fail("Active group document permission not found.", 404)

    try:
        permission.is_active = False
        permission.revoked_at = datetime.now(timezone.utc)
        audit(user.id, "group.document.revoke", "document", document_id, "success",
              {"group_id": group.id})
        db.session.commit()
    except Exception:
        db.session.rollback()
        return fail("Revoking group document access failed.", 500)

    return jsonify({"message": "Group document access revoked."}), 200
