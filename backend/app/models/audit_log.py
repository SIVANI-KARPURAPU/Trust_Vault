
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint

from ..extensions import db


class AuditLog(db.Model):
    __tablename__ = "audit_logs"

    # SQLite-compatible auto-incrementing primary key
    id = db.Column(
        db.Integer,
        primary_key=True,
        autoincrement=True,
    )

    actor_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=True,
        index=True,
    )

    action = db.Column(
        db.String(50),
        nullable=False,
        index=True,
    )

    resource_type = db.Column(
        db.String(50),
        nullable=False,
    )

    resource_id = db.Column(
        db.String(100),
        nullable=True,
        index=True,
    )

    outcome = db.Column(
        db.String(20),
        nullable=False,
        index=True,
    )

    ip_address = db.Column(
        db.String(45),
        nullable=True,
    )

    details = db.Column(
        db.JSON,
        nullable=False,
        default=dict,
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    actor = db.relationship(
        "User",
        foreign_keys=[actor_id],
    )

    __table_args__ = (
        CheckConstraint(
            "outcome IN ('success', 'denied', 'failure')",
            name="ck_audit_log_outcome",
        ),
    )
