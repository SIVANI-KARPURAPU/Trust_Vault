
from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token
from sqlalchemy.exc import IntegrityError

from ..extensions import db, limiter
from ..models import User
from ..services.audit_service import record_audit

auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/register")
@limiter.limit("5 per hour")
def register():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "A JSON request body is required."
        }), 400

    name = data.get("name")
    email = data.get("email")
    password = data.get("password")

    if not all(
        isinstance(value, str)
        for value in (name, email, password)
    ):
        return jsonify({
            "error": "Name, email and password must be strings."
        }), 400

    name = name.strip()
    email = email.strip().lower()

    if not name or len(name) > 120:
        return jsonify({
            "error": "Name is required and must be at most 120 characters."
        }), 400

    if (
        not email
        or len(email) > 255
        or email.count("@") != 1
        or email.startswith("@")
        or email.endswith("@")
        or "." not in email.rsplit("@", 1)[1]
    ):
        return jsonify({
            "error": "A valid email address is required."
        }), 400

    if len(password) < 12:
        return jsonify({
            "error": "Password must be at least 12 characters."
        }), 400

    # Public registration always creates a viewer.
    if User.query.filter_by(email=email).first():
        return jsonify({
            "error": "An account with this email already exists."
        }), 409

    user = User(
        name=name,
        email=email,
        role="viewer",
        is_active=True,
    )
    user.set_password(password)

    try:
        db.session.add(user)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({
            "error": "An account with this email already exists."
        }), 409

    return jsonify({
        "message": "Registration successful.",
        "user": user.to_dict(),
    }), 201


@auth_bp.post("/login")
@limiter.limit("5 per minute")
def login():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "A JSON request body is required."
        }), 400

    email = data.get("email")
    password = data.get("password")

    if not isinstance(email, str) or not isinstance(password, str):
        return jsonify({
            "error": "Email and password are required."
        }), 400

    email = email.strip().lower()

    if not email or not password:
        return jsonify({
            "error": "Email and password are required."
        }), 400

    user = User.query.filter_by(email=email).first()

    # Record failed login without storing the password or token.
    if user is None or not user.check_password(password):
        record_audit(
            actor_id=user.id if user else None,
            action="login",
            resource_type="auth",
            outcome="failure",
            ip_address=request.remote_addr,
            details={"reason": "invalid_credentials"},
        )
        db.session.commit()

        return jsonify({
            "error": "Invalid email or password."
        }), 401

    # Record attempts from inactive accounts.
    if not user.is_active:
        record_audit(
            actor_id=user.id,
            action="login",
            resource_type="auth",
            resource_id=user.id,
            outcome="denied",
            ip_address=request.remote_addr,
            details={"reason": "inactive_account"},
        )
        db.session.commit()

        return jsonify({
            "error": "This account is inactive."
        }), 403

    # Record successful authentication before issuing the token.
    record_audit(
        actor_id=user.id,
        action="login",
        resource_type="auth",
        resource_id=user.id,
        outcome="success",
        ip_address=request.remote_addr,
        details={"reason": "authenticated"},
    )
    db.session.commit()

    access_token = create_access_token(identity=str(user.id))

    return jsonify({
        "message": "Login successful.",
        "access_token": access_token,
        "token_type": "Bearer",
        "user": user.to_dict(),
    }), 200
