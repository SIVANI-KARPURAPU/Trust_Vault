
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import select

from ..extensions import db
from ..models import AuditLog
from ..security.authorization import role_required
from ..services.audit_service import verify_audit_chain

audit_bp = Blueprint("audit", __name__)


@audit_bp.get("/admin/audit-logs")
@jwt_required()
@role_required("admin")
def list_audit_logs():
    """Return paginated audit logs to administrators only."""
    try:
        page = request.args.get("page", default=1, type=int)
        per_page = request.args.get("per_page", default=20, type=int)

        if page is None or per_page is None or page < 1:
            return jsonify({"error": "Invalid pagination values."}), 400

        if per_page < 1 or per_page > 100:
            return jsonify({
                "error": "per_page must be between 1 and 100."
            }), 400

        total = db.session.scalar(
            select(db.func.count()).select_from(AuditLog)
        ) or 0

        entries = db.session.scalars(
            select(AuditLog)
            .order_by(AuditLog.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        ).all()

        return jsonify({
            "logs": [
                {
                    "id": entry.id,
                    "actor_id": entry.actor_id,
                    "action": entry.action,
                    "resource_type": entry.resource_type,
                    "resource_id": entry.resource_id,
                    "outcome": entry.outcome,
                    "ip_address": entry.ip_address,
                    "details": entry.details,
                    "created_at": entry.created_at.isoformat(),
                }
                for entry in entries
            ],
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "pages": (total + per_page - 1) // per_page,
            },
        }), 200

    except Exception:
        db.session.rollback()
        from flask import current_app
        current_app.logger.exception("Failed to retrieve audit logs")
        return jsonify({"error": "Could not retrieve audit logs."}), 500


@audit_bp.get("/admin/audit-logs/verify")
@jwt_required()
@role_required("admin")
def verify_audit_logs():
    """Verify the integrity of the audit hash chain."""
    try:
        result = verify_audit_chain()
        status_code = 200 if result["valid"] else 409
        return jsonify(result), status_code

    except Exception:
        db.session.rollback()
        from flask import current_app
        current_app.logger.exception("Audit chain verification failed")
        return jsonify({
            "error": "Could not verify the audit chain."
        }), 500
