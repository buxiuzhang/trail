#!/usr/bin/env python3
"""预迁移脚本：把 DuckDB 里的 Fernet 密文解成明文，写 data/llm_settings.plain.yaml。

与 trail_app/crypto.py:_load_or_create_key() 算法完全一致：
  1) 读 data/.secret_key（如存在）
  2) 否则按 PBKDF2HMAC(SHA256, salt=b"trail_v2_secret_salt_2026", iterations=480_000, length=32)
     + base64.urlsafe_b64encode(hostname.encode()) 派生
  3) Fernet 解 llm_settings.value

motto 字段是明文，跳过解密。

执行：
    python trail_api/scripts/dump_llm_settings.py
"""
from __future__ import annotations

import base64
import os
import platform
import sys
from pathlib import Path

import yaml
import duckdb
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


# 路径：脚本在 trail_api/scripts/，data 在 trail/data/
HERE = Path(__file__).resolve()
DATA_DIR = HERE.parent.parent.parent / "data"
KEY_FILE = DATA_DIR / ".secret_key"
DB_FILE = DATA_DIR / "tasks.duckdb"
OUT_FILE = DATA_DIR / "llm_settings.plain.yaml"

# 与 trail_app/crypto.py:23-34 完全一致
SALT = b"trail_v2_secret_salt_2026"
ITERATIONS = 480_000


def derive_key() -> bytes:
    host = platform.node() or "trail-local"
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=SALT,
        iterations=ITERATIONS,
    )
    return base64.urlsafe_b64encode(kdf.derive(host.encode()))


def load_key() -> bytes:
    """优先读 .secret_key；空/缺失时按算法派生。"""
    if KEY_FILE.exists() and KEY_FILE.stat().st_size > 0:
        return KEY_FILE.read_bytes()
    return derive_key()


def main() -> int:
    if not DB_FILE.exists():
        print(f"ERROR: 缺少数据库文件 {DB_FILE}", file=sys.stderr)
        return 1

    key = load_key()
    fernet = Fernet(key)

    # 读只读一份副本打开（避免与可能仍在跑的 DuckDB 写锁冲突——尽管本脚本应在停服后跑）
    con = duckdb.connect(str(DB_FILE), read_only=True)
    try:
        rows = con.execute("SELECT key, value FROM llm_settings ORDER BY key").fetchall()
    finally:
        con.close()

    plain: dict[str, str] = {}
    skipped: list[str] = []
    for k, v in rows:
        if not v:
            plain[k] = ""
            continue
        # motto 历史上是明文；非 motto 走 Fernet 解
        if k == "motto":
            plain[k] = v
        else:
            try:
                plain[k] = fernet.decrypt(v.encode()).decode()
            except Exception as e:
                print(f"WARN: 解密失败 key={k!r}，原样保留空串：{e}", file=sys.stderr)
                plain[k] = ""
                skipped.append(k)

    OUT_FILE.write_text(
        yaml.safe_dump(plain, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )

    # 输出结果
    print(f"✅ 已写出 {OUT_FILE}")
    print(f"   共 {len(plain)} 项")
    for k, v in plain.items():
        # API key 只显示长度 + 前 4 字符
        if "api_key" in k.lower() or "password" in k.lower():
            shown = f"<{len(v)} chars, head={v[:4]!r}...>" if v else "<empty>"
        else:
            shown = v if len(v) < 60 else v[:57] + "..."
        print(f"   - {k}: {shown}")
    if skipped:
        print(f"⚠️  跳过 {len(skipped)} 项（解密失败）：{skipped}", file=sys.stderr)

    print()
    print("下一步：")
    print("  1. 确认上面输出无 ERROR")
    print("  2. cd trail_api && mvn spring-boot:run")
    print("     → 启动时 PlainYamlImporter 会自动把明文用 AES-GCM 重新加密入库，")
    print("       并把 llm_settings.plain.yaml 重命名为 .plain.yaml.done（幂等）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
