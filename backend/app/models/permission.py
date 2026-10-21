from datetime import datetime, timezone

from ..extensions import db


class Permission(db.Model):
    __tablename__ = "document_permissions"

    id = db.Column(db.Integer, primary_key=True)

    document_id = db.Column(
        db.Integer,
        db.ForeignKey("documents.id"),
        nullable=False,
        index=True,
    )
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    access_level = db.Column(db.String(10), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    granted_by = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False,
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)

    document = db.relationship("Document", backref="permissions")
    user = db.relationship("User", foreign_keys=[user_id])
    grantor = db.relationship("User", foreign_keys=[granted_by])

    __table_args__ = (
        db.UniqueConstraint(
            "document_id",
            "user_id",
            name="uq_document_permission_user",
        ),
        db.CheckConstraint(
            "access_level IN ('read', 'edit')",
            name="ck_permission_access_level",
        ),
    )
