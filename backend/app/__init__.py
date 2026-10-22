from dotenv import load_dotenv

load_dotenv()

import os

from flask import Flask, jsonify
from flask_cors import CORS

from .config import Config
from .extensions import db, migrate, jwt, limiter
from .routes import (
    health_bp,
    auth_bp,
    profile_bp,
    documents_bp,
    permissions_bp,
    audit_bp,
    admin_bp,
    groups_bp,
)
from . import models


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.from_object(Config)

    if test_config:
        app.config.update(test_config)

    if not app.config.get("SECRET_KEY"):
        raise RuntimeError("SECRET_KEY must be configured.")

    if not app.config.get("JWT_SECRET_KEY"):
        raise RuntimeError("JWT_SECRET_KEY must be configured.")

    # Allow configured frontend origins.
    allowed_origins = [
        origin.strip()
        for origin in os.environ.get(
            "FRONTEND_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        ).split(",")
        if origin.strip()
    ]

    CORS(
        app,
        resources={
            r"/api/v1/*": {
                "origins": allowed_origins,
            }
        },
        allow_headers=["Content-Type", "Authorization"],
        methods=[
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS",
        ],
    )

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    limiter.init_app(app)

    app.register_blueprint(health_bp, url_prefix="/api/v1")
    app.register_blueprint(auth_bp, url_prefix="/api/v1/auth")
    app.register_blueprint(profile_bp, url_prefix="/api/v1")
    app.register_blueprint(documents_bp, url_prefix="/api/v1")
    app.register_blueprint(permissions_bp, url_prefix="/api/v1")
    app.register_blueprint(audit_bp, url_prefix="/api/v1")
    app.register_blueprint(admin_bp, url_prefix="/api/v1/admin")
    app.register_blueprint(groups_bp, url_prefix="/api/v1")

    @app.errorhandler(413)
    def file_too_large(_error):
        return jsonify({
            "error": "File exceeds the maximum allowed size."
        }), 413

    return app
