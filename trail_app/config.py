"""运行时配置加载：YAML 文件 + 环境变量。

**优先级**：环境变量 > YAML 文件 > 内置默认值。

**硬规则**：
- API key 永不入 DuckDB、永不写日志、永不返回给前端
- 加载后的 key 只活在内存里（函数返回值）
- 配置文件 `data/config.yaml` 在 .gitignore 内
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import yaml

from trail_app.utils import get_config_path_or_none


@dataclass
class LLMConfig:
    """LLM 调用配置。"""

    api_key: str
    base_url: str
    model: str
    max_tokens: int = 1000
    chat_system_prompt: str = ""

    def safe_repr(self) -> str:
        """脱敏 repr：api_key 打码，其它保留。可用于日志/调试。"""
        masked = (self.api_key[:4] + "***") if self.api_key else "<empty>"
        return f"LLMConfig(model={self.model!r}, base_url={self.base_url!r}, api_key={masked!r}, max_tokens={self.max_tokens})"


@dataclass
class DbSettings:
    """数据源配置。

    backend: "duckdb" | "mysql"（本期仅 duckdb 实际生效）
    duckdb_path: 相对 <项目根>/data/ 解析；绝对路径直用
    mysql: 字段占位（host/port/user/password/database），本期不写盘
    """

    backend: str = "duckdb"
    duckdb_path: str = "data/tasks.duckdb"
    mysql: dict | None = None


_DEFAULT_DUCKDB_PATH = "tasks.duckdb"


_DEFAULT_BASE_URL = "https://api.anthropic.com"
_DEFAULT_MINIMAX_BASE_URL = "https://api.minimaxi.com/anthropic"
_DEFAULT_MODEL = "claude-haiku-4-5"
_DEFAULT_MAX_TOKENS = 1000


def _load_yaml() -> dict:
    """读 YAML 配置；不存在返空 dict。"""
    p = get_config_path_or_none()
    if not p:
        return {}
    try:
        with p.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return data if isinstance(data, dict) else {}
    except (yaml.YAMLError, OSError):
        return {}


def _cfg_get(d: dict, *path: str, default: Any = None) -> Any:
    """按路径取值（a.b.c）。"""
    cur: Any = d
    for k in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return cur if cur is not None else default


def get_llm_config() -> Optional[LLMConfig]:
    """加载 LLM 配置。

    查找顺序：
    1. 环境变量 `ANTHROPIC_API_KEY`（必填，缺则返 None）
    2. base_url：env `ANTHROPIC_BASE_URL` > yaml `llm.base_url` > 默认
    3. model：env `ANTHROPIC_DEFAULT_HAIKU_MODEL` > yaml `llm.model` > 默认
    4. max_tokens：yaml `llm.max_tokens` > 默认 1000

    返回 None 表示未配置（不抛异常，调用方决定是否 503）。
    """
    yaml_cfg = _load_yaml()
    llm_yaml = _cfg_get(yaml_cfg, "llm", default={}) or {}

    # 依次尝试各来源，跳过太短的无效值
    def _valid_key(s: str) -> str:
        return s.strip() if len(s.strip()) >= 20 else ""

    # 最高优先级：DB 加密存储
    db_settings: dict = {}
    try:
        from trail_app.store import LLMSettingsStore
        db_settings = LLMSettingsStore().get_all()
    except Exception:
        pass

    yaml_key = _valid_key(_cfg_get(llm_yaml, "api_key", default=""))
    env_key = (
        _valid_key(os.environ.get("ANTHROPIC_API_KEY", ""))
        or _valid_key(os.environ.get("MINIMAX_API_KEY", ""))
    )
    db_key = _valid_key(db_settings.get("api_key", ""))

    # 优先级：DB > YAML > env
    if db_key:
        api_key = db_key
        db_base_url = db_settings.get("base_url", "").strip()
        using_minimax = "minimax" in db_base_url.lower() if db_base_url else False
        base_url = (
            db_base_url
            or os.environ.get("ANTHROPIC_BASE_URL", "").strip()
            or os.environ.get("MINIMAX_BASE_URL", "").strip()
            or (_DEFAULT_MINIMAX_BASE_URL if using_minimax else _DEFAULT_BASE_URL)
        )
        model = (
            db_settings.get("model", "").strip()
            or os.environ.get("ANTHROPIC_DEFAULT_HAIKU_MODEL", "").strip()
            or os.environ.get("MINIMAX_MODEL", "").strip()
            or ("MiniMax-M1" if using_minimax else _DEFAULT_MODEL)
        )
    elif yaml_key:
        api_key = yaml_key
        using_minimax = "minimax" in _cfg_get(llm_yaml, "base_url", default="").lower()
        base_url = (
            _cfg_get(llm_yaml, "base_url", default="")
            or os.environ.get("ANTHROPIC_BASE_URL", "").strip()
            or os.environ.get("MINIMAX_BASE_URL", "").strip()
            or (_DEFAULT_MINIMAX_BASE_URL if using_minimax else _DEFAULT_BASE_URL)
        )
        model = (
            _cfg_get(llm_yaml, "model", default="")
            or os.environ.get("ANTHROPIC_DEFAULT_HAIKU_MODEL", "").strip()
            or os.environ.get("MINIMAX_MODEL", "").strip()
            or ("MiniMax-M1" if using_minimax else _DEFAULT_MODEL)
        )
    else:
        api_key = env_key
        if not api_key:
            return None
        using_minimax = bool(_valid_key(os.environ.get("MINIMAX_API_KEY", "")))
        base_url = (
            os.environ.get("ANTHROPIC_BASE_URL", "").strip()
            or os.environ.get("MINIMAX_BASE_URL", "").strip()
            or (_DEFAULT_MINIMAX_BASE_URL if using_minimax else _DEFAULT_BASE_URL)
        )
        model = (
            os.environ.get("ANTHROPIC_DEFAULT_HAIKU_MODEL", "").strip()
            or os.environ.get("MINIMAX_MODEL", "").strip()
            or ("MiniMax-M1" if using_minimax else _DEFAULT_MODEL)
        )
    max_tokens = int(_cfg_get(llm_yaml, "max_tokens", default=_DEFAULT_MAX_TOKENS))

    # 对话提示词：DB > 默认（暂不从 YAML/env 读）
    from trail_app.prompts import DEFAULT_CHAT_SYSTEM
    chat_system_prompt = db_settings.get("chat_system_prompt", "").strip() or DEFAULT_CHAT_SYSTEM

    return LLMConfig(
        api_key=api_key,
        base_url=base_url,
        model=model,
        max_tokens=max_tokens,
        chat_system_prompt=chat_system_prompt,
    )


# ============================================================
# 数据源配置（M3+ 增强：用户可在设置页切 DuckDB/MySQL）
# ============================================================


def get_db_settings() -> DbSettings:
    """读 db: 段。

    容错：YAML 缺失 / 解析失败 / db 段缺失 / 各键缺失 → 全走默认 DuckDB + data/tasks.duckdb。
    backend 非法值（既不是 duckdb 也不是 mysql）→ 兜底 duckdb，不抛错。
    """
    cfg = _load_yaml()
    db = _cfg_get(cfg, "db", default={}) or {}
    if not isinstance(db, dict):
        db = {}

    backend = str(_cfg_get(db, "backend", default="duckdb") or "duckdb").strip().lower()
    if backend not in ("duckdb", "mysql"):
        backend = "duckdb"

    duck_yaml = _cfg_get(db, "duckdb", default={}) or {}
    if not isinstance(duck_yaml, dict):
        duck_yaml = {}
    duckdb_path = (
        str(_cfg_get(duck_yaml, "path", default=_DEFAULT_DUCKDB_PATH) or _DEFAULT_DUCKDB_PATH)
        .strip()
        or _DEFAULT_DUCKDB_PATH
    )

    mysql_yaml = _cfg_get(db, "mysql", default={}) or {}
    if not isinstance(mysql_yaml, dict):
        mysql_yaml = {}
    mysql = {
        "host":     str(_cfg_get(mysql_yaml, "host", default="127.0.0.1")),
        "port":     int(_cfg_get(mysql_yaml, "port", default=3306)),
        "user":     str(_cfg_get(mysql_yaml, "user", default="")),
        "password": str(_cfg_get(mysql_yaml, "password", default="")),
        "database": str(_cfg_get(mysql_yaml, "database", default="")),
    }

    return DbSettings(backend=backend, duckdb_path=duckdb_path, mysql=mysql)
