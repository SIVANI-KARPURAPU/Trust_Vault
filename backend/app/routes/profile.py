
from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import select

from ..extensions import db
from ..models import User

profile_bp = Blueprint("profile", __name__)


@profile_bp.get("/me")
@jwt_required()
def get_current_profile():
    user_id = get_jwt_identity()

    user = db.session.scalar(
        select(User).where(User.id == int(user_id))
    )

    if user is None or not user.is_active:
        return jsonify({
            "error": "Account not found or inactive."
        }), 401

    return jsonify({
        "user": user.to_dict()
    }), 200
