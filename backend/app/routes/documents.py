
import uuid
from pathlib import Path

from flask import (
    Blueprint,
    current_app,
    jsonify,
    request,
    send_file,
)
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import select
from werkzeug.utils import secure_filename

from ..extensions import db, limiter
from ..models import Document, Permission, User, GroupMembership, GroupPermission
from ..services.audit_service import record_audit

documents_bp = Blueprint("documents", __name__)

ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".txt"}

ALLOWED_CONTENT_TYPES = {
    ".pdf": {"application/pdf"},
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".txt": {"text/plain"},
}


def is_valid_file_content(uploaded_file, extension):
    """Check basic file signatures or UTF-8 text encoding."""
    stream = uploaded_file.stream

    try:
        stream.seek(0)

        if extension == ".pdf":
            return stream.read(5) == b"%PDF-"

        if extension == ".png":
            return stream.read(8) == b"\x89PNG\r\n\x1a\n"

        if extension in {".jpg", ".jpeg"}:
            return stream.read(3) == b"\xff\xd8\xff"

        if extension == ".txt":
            while True:
                chunk = stream.read(64 * 1024)
                if not chunk:
                    break
                chunk.decode("utf-8")
            return True

        return False

    except (UnicodeDecodeError, OSError, ValueError):
        return False

    finally:
        stream.seek(0)


def current_active_user():
    try:
        user_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return None

    user = db.session.scalar(
        select(User).where(User.id == user_id)
    )

    if user is None or not user.is_active:
        return None

    return user


def user_can_access_document(user, document, required_level="read"):
    """Check direct and active group permissions on every request."""
    if user.id == document.owner_id:
        return True

    allowed_levels = ("edit",) if required_level == "edit" else ("read", "edit")

    direct_permission = db.session.scalar(
        select(Permission).where(
            Permission.document_id == document.id,
            Permission.user_id == user.id,
            Permission.is_active.is_(True),
        )
    )

    if direct_permission and direct_permission.access_level in allowed_levels:
        return True

    active_group_ids = select(GroupMembership.group_id).where(
        GroupMembership.user_id == user.id
    )

    group_permission = db.session.scalar(
        select(GroupPermission.id).where(
            GroupPermission.document_id == document.id,
            GroupPermission.group_id.in_(active_group_ids),
            GroupPermission.is_active.is_(True),
            GroupPermission.access_level.in_(allowed_levels),
        ).limit(1)
    )

    return group_permission is not None


def document_response(document):
    return {
        "id": document.id,
        "title": document.title,
        "original_filename": document.original_filename,
        "category": document.category,
        "size_bytes": document.size_bytes,
        "created_at": document.created_at.isoformat(),
    }


def private_file_path(storage_key):
    """Resolve a storage key without allowing directory traversal."""
    storage_dir = Path(current_app.instance_path) / "private_uploads"
    storage_root = storage_dir.resolve()
    file_path = (storage_dir / storage_key).resolve()

    if file_path.parent != storage_root:
        return None

    return file_path


def log_denied_audit(
    *,
    user,
    action,
    resource_type,
    resource_id=None,
    details=None,
):
    """Persist denied-attempt audit events in their own transaction."""
    try:
        record_audit(
            actor_id=user.id if user else None,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            outcome="denied",
            ip_address=request.remote_addr,
            details=details or {},
        )
        db.session.commit()
        return True
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Failed to persist denied audit event")
        return False


@documents_bp.post("/documents")
@jwt_required()
@limiter.limit("10 per hour")
def upload_document():
    user = current_active_user()
    if user is not None:
        current_app.logger.warning(
            "DEBUG UPLOAD USER: id=%s email=%r role=%r",
            user.id, user.email, user.role,
        )
    else:
        current_app.logger.warning("DEBUG UPLOAD USER: no active user resolved")

    if user is None:
        if not log_denied_audit(
            user=None,
            action="document.upload",
            resource_type="document",
            details={"reason": "inactive_or_missing_account"},
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Account not found or inactive."}), 401

    # Owners and admins may upload documents. Viewers remain read-only.
    if str(user.role).lower() not in {"owner", "admin"}:
        if not log_denied_audit(
            user=user,
            action="document.upload",
            resource_type="document",
            details={"reason": "owner_or_admin_role_required"},
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Only owners and admins can upload documents."}), 403

    uploaded_file = request.files.get("file")
    title = request.form.get("title", "").strip()
    category = request.form.get("category", "").strip()

    if uploaded_file is None or not uploaded_file.filename:
        return jsonify({"error": "A file is required."}), 400

    if not title or len(title) > 255:
        return jsonify({
            "error": "Title is required (max 255 characters)."
        }), 400

    if not category or len(category) > 100:
        return jsonify({
            "error": "Category is required (max 100 characters)."
        }), 400

    safe_filename = secure_filename(uploaded_file.filename)

    if not safe_filename:
        return jsonify({"error": "Invalid filename."}), 400

    extension = Path(safe_filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        return jsonify({"error": "File type is not allowed."}), 415

    content_type = (uploaded_file.mimetype or "").lower()

    if content_type not in ALLOWED_CONTENT_TYPES[extension]:
        return jsonify({
            "error": "File content type does not match the allowed type."
        }), 415

    if not is_valid_file_content(uploaded_file, extension):
        return jsonify({
            "error": "File content does not match the selected file type."
        }), 415

    storage_dir = Path(current_app.instance_path) / "private_uploads"
    storage_dir.mkdir(parents=True, exist_ok=True)

    storage_key = f"{uuid.uuid4().hex}{extension}"
    destination = storage_dir / storage_key

    try:
        uploaded_file.save(destination)
        size_bytes = destination.stat().st_size

        if size_bytes == 0:
            destination.unlink(missing_ok=True)
            return jsonify({"error": "Empty files are not allowed."}), 400

        document = Document(
            title=title,
            original_filename=safe_filename,
            category=category,
            storage_key=storage_key,
            content_type=content_type,
            size_bytes=size_bytes,
            owner_id=user.id,
        )

        db.session.add(document)
        db.session.flush()

        record_audit(
            actor_id=user.id,
            action="document.upload",
            resource_type="document",
            resource_id=document.id,
            outcome="success",
            ip_address=request.remote_addr,
            details={
                "filename": safe_filename,
                "size_bytes": size_bytes,
                "category": category,
            },
        )

        db.session.commit()

    except Exception:
        db.session.rollback()
        destination.unlink(missing_ok=True)
        current_app.logger.exception("Document upload failed")
        return jsonify({"error": "Document upload failed."}), 500

    return jsonify({
        "message": "Document uploaded successfully.",
        "document": document_response(document),
    }), 201


@documents_bp.get("/documents")
@jwt_required()
def list_documents():
    user = current_active_user()

    if user is None:
        return jsonify({"error": "Account not found or inactive."}), 401

    owned_documents = db.session.scalars(
        select(Document)
        .where(Document.owner_id == user.id)
        .order_by(Document.created_at.desc())
    ).all()

    shared_permissions = db.session.scalars(
        select(Permission).where(
            Permission.user_id == user.id,
            Permission.is_active.is_(True),
        )
    ).all()

    shared_documents = []
    for permission in shared_permissions:
        document = db.session.get(Document, permission.document_id)
        if document is not None:
            shared_documents.append(document)

    active_group_ids = select(GroupMembership.group_id).where(
        GroupMembership.user_id == user.id
    )
    group_permissions = db.session.scalars(
        select(GroupPermission).where(
            GroupPermission.group_id.in_(active_group_ids),
            GroupPermission.is_active.is_(True),
        )
    ).all()

    for permission in group_permissions:
        document = db.session.get(Document, permission.document_id)
        if document is not None:
            shared_documents.append(document)

    documents_by_id = {
        document.id: document
        for document in owned_documents + shared_documents
    }

    documents = sorted(
        documents_by_id.values(),
        key=lambda item: item.created_at,
        reverse=True,
    )

    return jsonify({
        "documents": [
            document_response(document)
            for document in documents
        ]
    }), 200


@documents_bp.get("/documents/<int:document_id>/download")
@jwt_required()
def download_document(document_id):
    user = current_active_user()

    if user is None:
        if not log_denied_audit(
            user=None,
            action="document.download",
            resource_type="document",
            resource_id=document_id,
            details={"reason": "inactive_or_missing_account"},
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Account not found or inactive."}), 401

    document = db.session.get(Document, document_id)

    if document is None or not user_can_access_document(
        user, document, required_level="read"
    ):
        if not log_denied_audit(
            user=user,
            action="document.download",
            resource_type="document",
            resource_id=document_id,
            details={"reason": "document_not_found_or_access_denied"},
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Document not found."}), 404

    file_path = private_file_path(document.storage_key)

    if file_path is None or not file_path.is_file():
        try:
            record_audit(
                actor_id=user.id,
                action="document.download",
                resource_type="document",
                resource_id=document.id,
                outcome="failure",
                ip_address=request.remote_addr,
                details={"reason": "stored_file_unavailable"},
            )
            db.session.commit()
        except Exception:
            db.session.rollback()
            current_app.logger.exception("Download failure audit failed")

        return jsonify({"error": "Document file is unavailable."}), 404

    try:
        record_audit(
            actor_id=user.id,
            action="document.download",
            resource_type="document",
            resource_id=document.id,
            outcome="success",
            ip_address=request.remote_addr,
            details={"filename": document.original_filename},
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Download audit failed")
        return jsonify({"error": "Download could not be audited."}), 500

    response = send_file(
        file_path,
        mimetype=document.content_type,
        as_attachment=True,
        download_name=document.original_filename,
        conditional=False,
    )

    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"

    return response


@documents_bp.patch("/documents/<int:document_id>")
@jwt_required()
@limiter.limit("30 per hour")
def update_document(document_id):
    user = current_active_user()

    if user is None:
        if not log_denied_audit(
            user=None,
            action="document.edit",
            resource_type="document",
            resource_id=document_id,
            details={"reason": "inactive_or_missing_account"},
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Account not found or inactive."}), 401

    document = db.session.get(Document, document_id)

    if document is None or not user_can_access_document(
        user, document, required_level="edit"
    ):
        if not log_denied_audit(
            user=user,
            action="document.edit",
            resource_type="document",
            resource_id=document_id,
            details={"reason": "document_not_found_or_edit_denied"},
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Document not found."}), 404

    data = request.get_json(silent=True)

    if not isinstance(data, dict) or not data:
        return jsonify({
            "error": "A non-empty JSON request body is required."
        }), 400

    allowed_fields = {"title", "category"}

    if not set(data.keys()).issubset(allowed_fields):
        return jsonify({
            "error": "Only title and category can be updated."
        }), 400

    changes = {}

    if "title" in data:
        title = data["title"]

        if (
            not isinstance(title, str)
            or not title.strip()
            or len(title.strip()) > 255
        ):
            return jsonify({
                "error": "Title must be a non-empty string of at most 255 characters."
            }), 400

        changes["title"] = {
            "old": document.title,
            "new": title.strip(),
        }
        document.title = title.strip()

    if "category" in data:
        category = data["category"]

        if (
            not isinstance(category, str)
            or not category.strip()
            or len(category.strip()) > 100
        ):
            return jsonify({
                "error": "Category must be a non-empty string of at most 100 characters."
            }), 400

        changes["category"] = {
            "old": document.category,
            "new": category.strip(),
        }
        document.category = category.strip()

    try:
        record_audit(
            actor_id=user.id,
            action="document.edit",
            resource_type="document",
            resource_id=document.id,
            outcome="success",
            ip_address=request.remote_addr,
            details={"changes": changes},
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Document update failed")
        return jsonify({"error": "Document update failed."}), 500

    return jsonify({
        "message": "Document updated successfully.",
        "document": document_response(document),
    }), 200


@documents_bp.delete("/documents/<int:document_id>")
@jwt_required()
@limiter.limit("10 per hour")
def delete_document(document_id):
    user = current_active_user()

    if user is None:
        if not log_denied_audit(
            user=None,
            action="document.delete",
            resource_type="document",
            resource_id=document_id,
            details={"reason": "inactive_or_missing_account"},
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Account not found or inactive."}), 401

    document = db.session.get(Document, document_id)

    if document is None or document.owner_id != user.id:
        if not log_denied_audit(
            user=user,
            action="document.delete",
            resource_type="document",
            resource_id=document_id,
            details={"reason": "document_not_found_or_delete_denied"},
        ):
            return jsonify({"error": "Audit logging failed."}), 500

        return jsonify({"error": "Document not found."}), 404

    file_path = private_file_path(document.storage_key)

    if file_path is None:
        return jsonify({"error": "Invalid document storage location."}), 500

    storage_key = document.storage_key

    try:
        record_audit(
            actor_id=user.id,
            action="document.delete",
            resource_type="document",
            resource_id=document.id,
            outcome="success",
            ip_address=request.remote_addr,
            details={
                "filename": document.original_filename,
                "size_bytes": document.size_bytes,
            },
        )

        db.session.execute(
            db.delete(Permission).where(
                Permission.document_id == document.id
            )
        )
        db.session.delete(document)
        db.session.commit()

    except Exception:
        db.session.rollback()
        current_app.logger.exception("Document deletion failed")
        return jsonify({"error": "Document deletion failed."}), 500

    try:
        if file_path.is_file():
            file_path.unlink()
    except OSError:
        current_app.logger.exception(
            "Deleted document file cleanup failed: %s", storage_key
        )

    return jsonify({"message": "Document deleted successfully."}), 200
