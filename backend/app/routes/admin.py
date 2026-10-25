
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import select

from ..extensions import db
from ..models import User
from ..security.authorization import role_required
from ..services.audit_service import record_audit

admin_bp = Blueprint("admin", __name__)


@admin_bp.get("/users")
@jwt_required()
@role_required("admin")
def list_users():
    users = db.session.scalars(
        select(User).order_by(User.id.asc())
    ).all()

    return jsonify({
        "users": [user.to_dict() for user in users],
        "count": len(users),
    }), 200


@admin_bp.patch("/users/<int:user_id>/role")
@jwt_required()
@role_required("admin")
def promote_user(user_id):
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "A JSON request body is required."
        }), 400

    requested_role = data.get("role")
    new_role = requested_role.strip().lower() if isinstance(requested_role, str) else None

    if new_role not in ("owner", "viewer"):
        return jsonify({
            "error": "Role must be either 'owner' or 'viewer'."
        }), 400

    user = db.session.get(User, user_id)

    if user is None:
        return jsonify({
            "error": "User not found."
        }), 404

    if user.role == "admin":
        return jsonify({
            "error": "An admin account cannot be changed here."
        }), 409

    previous_role = str(user.role).strip().lower()

    if previous_role == new_role:
        return jsonify({
            "message": f"User already has the {new_role} role.",
            "user": user.to_dict(),
        }), 200

    admin_id = int(get_jwt_identity())

    try:
        user.role = new_role

        record_audit(
            actor_id=admin_id,
            action="role_changed",
            resource_type="user",
            resource_id=user.id,
            outcome="success",
            ip_address=request.remote_addr,
            details={
                "previous_role": previous_role,
                "new_role": new_role,
            },
        )

        db.session.commit()

    except Exception:
        db.session.rollback()
        return jsonify({
            "error": "Role update failed. No changes were saved."
        }), 500

    return jsonify({
        "message": (
            f"User role changed from {previous_role} to {new_role}."
        ),
        "user": user.to_dict(),
    }), 200
