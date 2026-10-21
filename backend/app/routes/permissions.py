
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import select

from ..extensions import db
from ..models import Document, Permission, User
from ..services.audit_service import record_audit

permissions_bp = Blueprint("permissions", __name__)


def get_active_user():
    try:
        user_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return None

    user = db.session.scalar(select(User).where(User.id == user_id))

    if user is None or not user.is_active:
        return None

    return user


def get_owned_document(document_id, user):
    return db.session.scalar(
        select(Document).where(
            Document.id == document_id,
            Document.owner_id == user.id,
        )
    )


def log_permission_denial(user, action, document_id, details=None):
    """Record a denied permission-management attempt."""
    try:
        record_audit(
            actor_id=user.id if user else None,
            action=action,
            resource_type="permission",
            resource_id=document_id,
            outcome="denied",
            ip_address=request.remote_addr,
            details=details or {},
        )
        db.session.commit()
        return True
    except Exception:
        db.session.rollback()
        from flask import current_app
        current_app.logger.exception("Permission denial audit failed")
        return False


@permissions_bp.post("/documents/<int:document_id>/permissions")
@jwt_required()
def grant_permission(document_id):
    owner = get_active_user()

    if owner is None:
        if not log_permission_denial(
            None, "permission.grant", document_id,
            {"reason": "inactive_or_missing_account"},
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Account not found or inactive."}), 401

    if owner.role != "owner":
        if not log_permission_denial(
            owner, "permission.grant", document_id,
            {"reason": "owner_role_required"},
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({
            "error": "Only owners can manage document permissions."
        }), 403

    document = get_owned_document(document_id, owner)

    if document is None:
        if not log_permission_denial(
            owner, "permission.grant", document_id,
            {"reason": "document_not_found_or_not_owned"},
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Document not found."}), 404

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({"error": "A JSON request body is required."}), 400

    target_email = data.get("email")
    access_level = data.get("access_level")

    if not isinstance(target_email, str) or not isinstance(access_level, str):
        return jsonify({"error": "Email and access_level are required."}), 400

    target_email = target_email.strip().lower()
    access_level = access_level.strip().lower()

    if access_level not in ("read", "edit"):
        return jsonify({"error": "Access level must be read or edit."}), 400

    target_user = db.session.scalar(
        select(User).where(
            User.email == target_email,
            User.is_active.is_(True),
        )
    )

    if target_user is None:
        return jsonify({"error": "Active target user not found."}), 404

    if target_user.id == owner.id:
        return jsonify({"error": "You already own this document."}), 400

    permission = db.session.scalar(
        select(Permission).where(
            Permission.document_id == document.id,
            Permission.user_id == target_user.id,
        )
    )

    try:
        if permission is None:
            permission = Permission(
                document_id=document.id,
                user_id=target_user.id,
                access_level=access_level,
                is_active=True,
                granted_by=owner.id,
            )
            db.session.add(permission)
        else:
            permission.access_level = access_level
            permission.is_active = True
            permission.granted_by = owner.id
            permission.revoked_at = None

        db.session.flush()

        record_audit(
            actor_id=owner.id,
            action="permission.grant",
            resource_type="permission",
            resource_id=document.id,
            outcome="success",
            ip_address=request.remote_addr,
            details={
                "document_id": document.id,
                "target_user_id": target_user.id,
                "target_email": target_user.email,
                "access_level": access_level,
            },
        )

        db.session.commit()

    except Exception:
        db.session.rollback()
        from flask import current_app
        current_app.logger.exception("Permission grant failed")
        return jsonify({"error": "Permission grant failed."}), 500

    return jsonify({
        "message": "Permission granted.",
        "permission": {
            "document_id": document.id,
            "user_id": target_user.id,
            "email": target_user.email,
            "access_level": permission.access_level,
            "is_active": permission.is_active,
        },
    }), 200


@permissions_bp.delete(
    "/documents/<int:document_id>/permissions/<int:target_user_id>"
)
@jwt_required()
def revoke_permission(document_id, target_user_id):
    owner = get_active_user()

    if owner is None:
        if not log_permission_denial(
            None, "permission.revoke", document_id,
            {
                "target_user_id": target_user_id,
                "reason": "inactive_or_missing_account",
            },
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Account not found or inactive."}), 401

    if owner.role != "owner":
        if not log_permission_denial(
            owner, "permission.revoke", document_id,
            {
                "target_user_id": target_user_id,
                "reason": "owner_role_required",
            },
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({
            "error": "Only owners can manage document permissions."
        }), 403

    document = get_owned_document(document_id, owner)

    if document is None:
        if not log_permission_denial(
            owner, "permission.revoke", document_id,
            {
                "target_user_id": target_user_id,
                "reason": "document_not_found_or_not_owned",
            },
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Document not found."}), 404

    permission = db.session.scalar(
        select(Permission).where(
            Permission.document_id == document.id,
            Permission.user_id == target_user_id,
            Permission.is_active.is_(True),
        )
    )

    if permission is None:
        if not log_permission_denial(
            owner, "permission.revoke", document_id,
            {
                "target_user_id": target_user_id,
                "reason": "active_permission_not_found",
            },
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Active permission not found."}), 404

    try:
        permission.is_active = False
        permission.revoked_at = datetime.now(timezone.utc)

        record_audit(
            actor_id=owner.id,
            action="permission.revoke",
            resource_type="permission",
            resource_id=document.id,
            outcome="success",
            ip_address=request.remote_addr,
            details={
                "document_id": document.id,
                "target_user_id": target_user_id,
            },
        )

        db.session.commit()

    except Exception:
        db.session.rollback()
        from flask import current_app
        current_app.logger.exception("Permission revoke failed")
        return jsonify({"error": "Permission revoke failed."}), 500

    return jsonify({"message": "Permission revoked."}), 200
