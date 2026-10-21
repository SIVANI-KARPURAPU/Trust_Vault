
import pytest

from backend.app import create_app
from backend.app.extensions import db
from backend.app.models import AuditLog
from backend.app.services.audit_service import (
    record_audit,
    verify_audit_chain,
)


@pytest.fixture()
def app():
    app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite://",
    })

    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


def test_empty_audit_chain_is_valid(app):
    with app.app_context():
        result = verify_audit_chain()

        assert result["valid"] is True
        assert result["entries_checked"] == 0


def test_recorded_entry_passes_chain_verification(app):
    with app.app_context():
        record_audit(
            actor_id=None,
            action="document.upload",
            resource_type="document",
            resource_id="123",
            outcome="success",
            details={"filename": "sample.txt"},
        )
        db.session.commit()

        result = verify_audit_chain()

        assert result["valid"] is True
        assert result["entries_checked"] == 1


def test_multiple_entries_form_a_valid_chain(app):
    with app.app_context():
        record_audit(
            actor_id=None,
            action="document.upload",
            resource_type="document",
            resource_id="123",
        )
        db.session.commit()

        record_audit(
            actor_id=None,
            action="document.download",
            resource_type="document",
            resource_id="123",
        )
        db.session.commit()

        result = verify_audit_chain()

        assert result["valid"] is True
        assert result["entries_checked"] == 2


def test_tampered_details_are_detected(app):
    with app.app_context():
        entry = record_audit(
            actor_id=None,
            action="document.upload",
            resource_type="document",
            resource_id="123",
            details={"filename": "sample.txt"},
        )
        db.session.commit()

        entry.details = {
            **entry.details,
            "filename": "changed.txt",
        }
        db.session.commit()

        result = verify_audit_chain()

        assert result["valid"] is False
        assert result["entry_id"] == entry.id


def test_invalid_outcome_is_rejected(app):
    with app.app_context():
        with pytest.raises(ValueError):
            record_audit(
                actor_id=None,
                action="document.upload",
                resource_type="document",
                outcome="unknown",
            )
