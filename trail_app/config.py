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

    def safe_repr(self) -> str:
        """脱敏 repr：api_key 打码，其它保留。可用于日志/调试。"""
        masked = (self.api_key[:4] + "***") if self.api_key else "<empty>"
        return f"LLMConfig(model={self.model!r}, base_url={self.base_url!r}, api_key={masked!r}, max_tokens={self.max_tokens})"


_DEFAULT_BASE_URL = "https://api.anthropic.com"
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
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return None

    yaml_cfg = _load_yaml()
    llm_yaml = _cfg_get(yaml_cfg, "llm", default={}) or {}

    base_url = (
        os.environ.get("ANTHROPIC_BASE_URL", "").strip()
        or _cfg_get(llm_yaml, "base_url", default=_DEFAULT_BASE_URL)
    )
    model = (
        os.environ.get("ANTHROPIC_DEFAULT_HAIKU_MODEL", "").strip()
        or _cfg_get(llm_yaml, "model", default=_DEFAULT_MODEL)
    )
    max_tokens = int(_cfg_get(llm_yaml, "max_tokens", default=_DEFAULT_MAX_TOKENS))

    return LLMConfig(
        api_key=api_key,
        base_url=base_url,
        model=model,
        max_tokens=max_tokens,
    )
