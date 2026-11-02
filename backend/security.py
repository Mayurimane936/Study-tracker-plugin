
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


# Always load backend/.env, regardless of the terminal's current directory.
ENV_FILE = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=ENV_FILE, override=False)

# Security settings
PBKDF2_ITERATIONS = 600_000
TOKEN_LIFETIME_SECONDS = 60 * 60 * 24  # 24 hours


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def hash_password(password: str) -> str:
    """Hash a password using PBKDF2-HMAC-SHA256."""
    if len(password) < 8:
        raise ValueError("Password must contain at least 8 characters.")

    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )

    return (
        f"pbkdf2_sha256${PBKDF2_ITERATIONS}"
        f"${_b64encode(salt)}${_b64encode(digest)}"
    )


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a password against a stored password hash."""
    try:
        algorithm, iterations, salt_text, digest_text = stored_hash.split("$")

        if algorithm != "pbkdf2_sha256":
            return False

        rounds = int(iterations)
        if not 100_000 <= rounds <= 2_000_000:
            return False

        salt = _b64decode(salt_text)
        expected_digest = _b64decode(digest_text)

        actual_digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            rounds,
        )

        return hmac.compare_digest(actual_digest, expected_digest)

    except (ValueError, TypeError, UnicodeError):
        return False


def _get_secret() -> bytes:
    secret = os.getenv("STUDYTRACK_SECRET_KEY", "").strip()

    if len(secret) < 32:
        raise RuntimeError(
            "STUDYTRACK_SECRET_KEY is missing or too short. "
            "Add a random secret of at least 32 characters to "
            "backend/.env, then restart Python."
        )

    return secret.encode("utf-8")


def create_access_token(user_id: int) -> str:
    """Create a signed access token for a user."""
    if user_id <= 0:
        raise ValueError("user_id must be a positive integer.")

    now = int(time.time())

    header = {
        "alg": "HS256",
        "typ": "JWT",
    }
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + TOKEN_LIFETIME_SECONDS,
    }

    header_part = _b64encode(
        json.dumps(header, separators=(",", ":")).encode("utf-8")
    )
    payload_part = _b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    )

    signing_input = f"{header_part}.{payload_part}".encode("ascii")

    signature = hmac.new(
        _get_secret(),
        signing_input,
        hashlib.sha256,
    ).digest()

    return (
        f"{header_part}.{payload_part}."
        f"{_b64encode(signature)}"
    )


def verify_access_token(token: str) -> dict[str, Any] | None:
    """Validate the token signature, structure, and expiry."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None

        header_part, payload_part, signature_part = parts

        signing_input = f"{header_part}.{payload_part}".encode("ascii")

        expected_signature = hmac.new(
            _get_secret(),
            signing_input,
            hashlib.sha256,
        ).digest()

        supplied_signature = _b64decode(signature_part)

        if not hmac.compare_digest(
            expected_signature,
            supplied_signature,
        ):
            return None

        header = json.loads(_b64decode(header_part))
        payload = json.loads(_b64decode(payload_part))

        if header.get("alg") != "HS256":
            return None

        if header.get("typ") != "JWT":
            return None

        user_id = int(payload["sub"])
        issued_at = int(payload["iat"])
        expiration = int(payload["exp"])
        now = int(time.time())

        if user_id <= 0:
            return None

        if issued_at > now + 60 or expiration <= now:
            return None

        if expiration <= issued_at:
            return None

        return payload

    except (
        ValueError,
        TypeError,
        KeyError,
        UnicodeError,
        json.JSONDecodeError,
    ):
        return None
