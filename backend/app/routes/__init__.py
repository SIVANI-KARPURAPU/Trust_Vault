
from .health import health_bp
from .auth import auth_bp
from .profile import profile_bp
from .documents import documents_bp
from .permissions import permissions_bp
from .audit import audit_bp

__all__ = [
    "health_bp",
    "auth_bp",
    "profile_bp",
    "documents_bp",
    "permissions_bp",
    "audit_bp",
]
