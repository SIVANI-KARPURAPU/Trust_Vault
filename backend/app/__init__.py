
from dotenv import load_dotenv

load_dotenv()

from flask import Flask, jsonify

from .config import Config
from .extensions import db, migrate, jwt, limiter
from .routes import (
    health_bp,
    auth_bp,
    profile_bp,
    documents_bp,
    permissions_bp,
    audit_bp,
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

    @app.errorhandler(413)
    def file_too_large(_error):
        return jsonify({
            "error": "File exceeds the maximum allowed size."
        }), 413

    return app
