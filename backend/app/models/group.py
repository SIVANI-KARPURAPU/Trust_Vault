
from datetime import datetime, timezone

from ..extensions import db


class Group(db.Model):
    __tablename__ = "groups"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.String(500), nullable=False, default="")
    owner_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    owner = db.relationship("User", foreign_keys=[owner_id])

    __table_args__ = (
        db.UniqueConstraint(
            "owner_id",
            "name",
            name="uq_group_owner_name",
        ),
    )


class GroupMembership(db.Model):
    __tablename__ = "group_memberships"

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(
        db.Integer,
        db.ForeignKey("groups.id"),
        nullable=False,
        index=True,
    )
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    added_by = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False,
    )
    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    group = db.relationship("Group")
    user = db.relationship("User", foreign_keys=[user_id])
    added_by_user = db.relationship("User", foreign_keys=[added_by])

    __table_args__ = (
        db.UniqueConstraint(
            "group_id",
            "user_id",
            name="uq_group_membership",
        ),
    )


class GroupPermission(db.Model):
    __tablename__ = "group_permissions"

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(
        db.Integer,
        db.ForeignKey("groups.id"),
        nullable=False,
        index=True,
    )
    document_id = db.Column(
        db.Integer,
        db.ForeignKey("documents.id"),
        nullable=False,
        index=True,
    )
    access_level = db.Column(db.String(10), nullable=False)
    granted_by = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False,
    )
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)

    group = db.relationship("Group")
    document = db.relationship("Document")
    grantor = db.relationship("User", foreign_keys=[granted_by])

    __table_args__ = (
        db.UniqueConstraint(
            "group_id",
            "document_id",
            name="uq_group_document_permission",
        ),
        db.CheckConstraint(
            "access_level IN ('read', 'edit')",
            name="ck_group_permission_access_level",
        ),
    )
