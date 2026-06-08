"""LLM 配置加密存储。

使用 Fernet（AES-128-CBC）对称加密。
密钥文件保存在 data/.secret_key，首次自动生成。
"""
from __future__ import annotations

import base64
import os
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from trail_app.utils import get_data_dir


def _key_path() -> Path:
    return get_data_dir() / ".secret_key"


def _derive_key() -> bytes:
    """基于机器 hostname + 固定盐派生 256-bit 密钥。"""
    import platform
    host = platform.node() or "trail-local"
    salt = b"trail_v2_secret_salt_2026"
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=480_000,
    )
    return base64.urlsafe_b64encode(kdf.derive(host.encode()))


def _load_or_create_key() -> bytes:
    kp = _key_path()
    if kp.exists():
        return kp.read_bytes()
    key = _derive_key()
    kp.parent.mkdir(parents=True, exist_ok=True)
    kp.write_bytes(key)
    try:
        os.chmod(kp, 0o600)
    except OSError:
        pass
    return key


_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_load_or_create_key())
    return _fernet


def encrypt(plain: str) -> str:
    """加密字符串，返回 base64 token。"""
    if not plain:
        return ""
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt(token: str) -> str:
    """解密，返回明文。token 为空或无效时返回空字符串。"""
    if not token:
        return ""
    try:
        return _get_fernet().decrypt(token.encode()).decode()
    except Exception:
        return ""
