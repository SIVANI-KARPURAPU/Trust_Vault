import pytest
from backend.app.models import User


def test_password_is_hashed():
    user = User(name="Test User", email="test@example.com", role="viewer")
    user.set_password("TestPass123!")

    assert user.password_hash != "TestPass123!"
    assert user.check_password("TestPass123!")


def test_wrong_password_is_rejected():
    user = User(name="Test User", email="test@example.com", role="viewer")
    user.set_password("TestPass123!")

    assert not user.check_password("WrongPass123!")


def test_user_response_does_not_expose_password_hash():
    user = User(name="Test User", email="test@example.com", role="viewer")
    user.set_password("TestPass123!")
    response = user.to_dict()

    assert "password_hash" not in response
    assert response["role"] == "viewer"


@pytest.mark.parametrize("role", ["admin", "owner", "viewer"])
def test_valid_user_roles(role):
    user = User(
        name="Test User",
        email=f"{role}@example.com",
        role=role,
    )

    assert user.role == role


def test_invalid_role_is_rejected_by_database():
    from sqlalchemy.exc import IntegrityError
    from backend.app import create_app
    from backend.app.extensions import db

    app = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
    })

    with app.app_context():
        db.create_all()

        user = User(
            name="Invalid Role",
            email="invalid@example.com",
            role="superadmin",
        )
        user.set_password("TestPass123!")

        db.session.add(user)

        with pytest.raises(IntegrityError):
            db.session.commit()

        db.session.rollback()
        db.drop_all()