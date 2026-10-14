"""Password hashing and JWT helpers. / 密码哈希和 JWT 工具。"""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
from jose import JWTError, jwt
from .config import get_settings

ALGORITHM = "HS256"

def hash_password(password: str) -> str:
    # PBKDF2 is available in the Python standard library.
    # PBKDF2 属于 Python 标准库，无需额外密码库。
    salt = os.urandom(16)
    rounds = 120_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, rounds)
    return f"pbkdf2_sha256${rounds}${salt.hex()}${digest.hex()}"

def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = stored_hash.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(candidate.hex(), digest_hex)
    except (ValueError, TypeError):
        return False

def create_access_token(user_id: int) -> str:
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": str(user_id), "exp": expires}, settings.secret_key, algorithm=ALGORITHM)

def decode_access_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, get_settings().secret_key, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except (JWTError, KeyError, TypeError, ValueError):
        return None
