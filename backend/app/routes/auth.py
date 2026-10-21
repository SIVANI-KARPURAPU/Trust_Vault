
from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token
from sqlalchemy.exc import IntegrityError

from ..extensions import db, limiter
from ..models import User

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

    # Public registration never trusts a client-supplied role.
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

    user = User.query.filter_by(email=email).first()

    # Use the same response for unknown email and wrong password.
    if user is None or not user.check_password(password):
        return jsonify({
            "error": "Invalid email or password."
        }), 401

    if not user.is_active:
        return jsonify({
            "error": "This account is inactive."
        }), 403

    access_token = create_access_token(identity=str(user.id))

    return jsonify({
        "message": "Login successful.",
        "access_token": access_token,
        "token_type": "Bearer",
        "user": user.to_dict(),
    }), 200
