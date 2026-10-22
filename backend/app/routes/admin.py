
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

    if data.get("role") != "owner":
        return jsonify({
            "error": "Only promotion to owner is supported."
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

    if user.role == "owner":
        return jsonify({
            "message": "User is already an owner.",
            "user": user.to_dict(),
        }), 200

    previous_role = user.role
    admin_id = int(get_jwt_identity())

    user.role = "owner"

    record_audit(
        actor_id=admin_id,
        action="role_promoted",
        resource_type="user",
        resource_id=user.id,
        outcome="success",
        ip_address=request.remote_addr,
        details={
            "previous_role": previous_role,
            "new_role": "owner",
        },
    )

    db.session.commit()

    return jsonify({
        "message": "User promoted to owner successfully.",
        "user": user.to_dict(),
    }), 200
