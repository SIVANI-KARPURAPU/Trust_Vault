
from functools import wraps

from flask import jsonify
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from sqlalchemy import select

from ..extensions import db
from ..models import User


def role_required(*allowed_roles):
    """Require an authenticated, active user with an allowed database role."""

    def decorator(view_function):
        @wraps(view_function)
        def wrapped(*args, **kwargs):
            # Verify the JWT before trusting its identity.
            verify_jwt_in_request()

            identity = get_jwt_identity()

            try:
                user_id = int(identity)
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid authentication identity."}), 401

            user = db.session.scalar(
                select(User).where(User.id == user_id)
            )

            if user is None or not user.is_active:
                return jsonify({"error": "Account not found or inactive."}), 401

            if user.role not in allowed_roles:
                return jsonify({"error": "You do not have permission to perform this action."}), 403

            return view_function(*args, **kwargs)

        return wrapped

    return decorator
