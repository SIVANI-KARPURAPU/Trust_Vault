
import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import select

from ..extensions import db
from ..models import AuditLog


GENESIS_HASH = "0" * 64
VALID_OUTCOMES = {"success", "denied", "failure"}


def canonical_json(value):
    """Serialize data consistently for reproducible hashes."""
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )


def calculate_entry_hash(entry_data):
    """Calculate the SHA-256 hash of an audit entry."""
    return hashlib.sha256(
        canonical_json(entry_data).encode("utf-8")
    ).hexdigest()


def normalize_timestamp(value):
    """Normalize timestamps to UTC ISO-8601 format."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)

    return value.isoformat()


def record_audit(
    *,
    actor_id,
    action,
    resource_type,
    resource_id=None,
    outcome="success",
    ip_address=None,
    details=None,
):
    """
    Append a hash-linked audit entry.

    Call inside a Flask application context.
    The caller is responsible for committing the transaction.
    """
    if outcome not in VALID_OUTCOMES:
        raise ValueError("Invalid audit outcome.")

    if not isinstance(action, str) or not action.strip():
        raise ValueError("Audit action is required.")

    if not isinstance(resource_type, str) or not resource_type.strip():
        raise ValueError("Audit resource_type is required.")

    if details is not None and not isinstance(details, dict):
        raise ValueError("Audit details must be a dictionary.")

    # Read the latest entry in the existing chain.
    previous = db.session.scalar(
        select(AuditLog)
        .order_by(AuditLog.id.desc())
        .limit(1)
    )

    previous_hash = None

    if previous is not None:
        previous_details = previous.details

        if not isinstance(previous_details, dict):
            raise RuntimeError(
                "Previous audit entry has invalid details."
            )

        previous_chain = previous_details.get("_chain")

        if not isinstance(previous_chain, dict):
            raise RuntimeError(
                "Previous audit entry has no chain metadata."
            )

        previous_hash = previous_chain.get("entry_hash")

        if not isinstance(previous_hash, str) or len(previous_hash) != 64:
            raise RuntimeError(
                "Previous audit entry has an invalid hash."
            )

    previous_hash = previous_hash or GENESIS_HASH
    timestamp = datetime.now(timezone.utc).isoformat()

    safe_details = dict(details or {})

    # Prevent callers from supplying their own chain metadata.
    safe_details.pop("_chain", None)

    entry_data = {
        "actor_id": actor_id,
        "action": action.strip(),
        "resource_type": resource_type.strip(),
        "resource_id": (
            str(resource_id) if resource_id is not None else None
        ),
        "outcome": outcome,
        "ip_address": ip_address,
        "created_at": timestamp,
        "details": safe_details,
        "previous_hash": previous_hash,
    }

    entry_hash = calculate_entry_hash(entry_data)

    stored_details = {
        **safe_details,
        "_chain": {
            "previous_hash": previous_hash,
            "entry_hash": entry_hash,
        },
    }

    entry = AuditLog(
        actor_id=actor_id,
        action=action.strip(),
        resource_type=resource_type.strip(),
        resource_id=(
            str(resource_id) if resource_id is not None else None
        ),
        outcome=outcome,
        ip_address=ip_address,
        details=stored_details,
        created_at=datetime.fromisoformat(timestamp),
    )

    db.session.add(entry)
    db.session.flush()

    return entry


def verify_audit_chain():
    """
    Verify every entry's hash and its link to the previous entry.

    A valid result does not prove protection against an attacker
    who can rewrite the entire database and recalculate every hash.
    External protected checkpoints are needed for that threat.
    """
    entries = db.session.scalars(
        select(AuditLog).order_by(AuditLog.id.asc())
    ).all()

    expected_previous_hash = GENESIS_HASH

    for entry in entries:
        if not isinstance(entry.details, dict):
            return {
                "valid": False,
                "entry_id": entry.id,
                "reason": "Invalid details format.",
            }

        chain = entry.details.get("_chain")

        if not isinstance(chain, dict):
            return {
                "valid": False,
                "entry_id": entry.id,
                "reason": "Missing chain metadata.",
            }

        stored_previous_hash = chain.get("previous_hash")
        stored_entry_hash = chain.get("entry_hash")

        if stored_previous_hash != expected_previous_hash:
            return {
                "valid": False,
                "entry_id": entry.id,
                "reason": "Previous hash does not match.",
            }

        if not isinstance(stored_entry_hash, str):
            return {
                "valid": False,
                "entry_id": entry.id,
                "reason": "Invalid entry hash format.",
            }

        safe_details = {
            key: value
            for key, value in entry.details.items()
            if key != "_chain"
        }

        entry_data = {
            "actor_id": entry.actor_id,
            "action": entry.action,
            "resource_type": entry.resource_type,
            "resource_id": entry.resource_id,
            "outcome": entry.outcome,
            "ip_address": entry.ip_address,
            "created_at": normalize_timestamp(entry.created_at),
            "details": safe_details,
            "previous_hash": stored_previous_hash,
        }

        calculated_hash = calculate_entry_hash(entry_data)

        if calculated_hash != stored_entry_hash:
            return {
                "valid": False,
                "entry_id": entry.id,
                "reason": "Entry hash does not match.",
            }

        expected_previous_hash = stored_entry_hash

    return {
        "valid": True,
        "entries_checked": len(entries),
        "last_hash": expected_previous_hash,
    }
