"""/api/settings/db — 数据源配置读写。

设计：
- GET 返当前 db: 段 + DuckDB 路径的绝对路径（前端回显用）
- PUT 写 db: 段到 data/config.yaml；load → 改 db 段 → dump，不破坏 llm: 段
- 原子写：tempfile + os.replace
- MySQL 字段本期不写盘（HTTP 409）
- 切换 backend 不要求数据迁移，但前端会引导"重启后生效"
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException

from trail_app.config import get_db_settings
from trail_app.utils import get_config_path, get_data_dir

router = APIRouter(prefix="/api/settings", tags=["settings-db"])


def _resolve_abs(path_str: str) -> Path:
    """把配置里的 path 字段还原为绝对路径（仅用于前端回显）。"""
    p = Path(path_str)
    return p if p.is_absolute() else get_data_dir() / p


@router.get("/db")
def get_db() -> dict:
    """返回当前 db: 段配置；YAML 缺失/解析失败 → 走默认 DuckDB + data/tasks.duckdb。"""
    s = get_db_settings()
    return {
        "backend": s.backend,
        "duckdb": {
            "path": s.duckdb_path,
            "absolute_path": str(_resolve_abs(s.duckdb_path)),
        },
        "mysql": s.mysql,
        "defaults": {
            "duckdb_path": "tasks.duckdb",
        },
    }


@router.put("/db")
def save_db(data: dict) -> dict:
    """保存 db: 段到 data/config.yaml。

    规则：
    - backend 仅接受 "duckdb" | "mysql"
    - backend=mysql：本期直接 HTTP 409 拒绝，**不**写盘
    - backend=duckdb：duckdb.path 非空；相对路径存原文（启动时 get_db_path 再解析）
    - 软校验：父目录可创建（不存在则 mkdir）
    - 原子写：load → 改 db 段 → dump 到临时文件 → os.replace
    """
    backend_raw = data.get("backend", "duckdb")
    backend = str(backend_raw).strip().lower() if backend_raw is not None else "duckdb"
    if backend not in ("duckdb", "mysql"):
        raise HTTPException(400, f"未知 backend：{backend_raw!r}")

    if backend == "mysql":
        # 本里程碑：MySQL 驱动未实现 → 拒绝写盘，提示用户
        raise HTTPException(
            409,
            "MySQL 驱动尚未实现，请先选择 DuckDB。"
            "（开发提示：若要临时实验，可手动编辑 data/config.yaml 改 db.backend=mysql，"
            "但下次启动会被 lifespan 拒绝。）",
        )

    # ---- backend=duckdb ----
    duck = data.get("duckdb") or {}
    if not isinstance(duck, dict):
        raise HTTPException(400, "duckdb 字段必须是对象")

    path_str = str(duck.get("path", "") or "").strip() or "data/tasks.duckdb"
    pp = Path(path_str)
    if pp.is_absolute():
        stored = path_str
        parent = pp.parent
    else:
        stored = path_str
        parent = get_data_dir() / path_str
        parent = parent.parent  # 相对路径里的父目录

    # 软校验：父目录存在 / 可写；不存在则尝试创建
    if not parent.exists():
        try:
            parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise HTTPException(400, f"无法创建父目录：{parent}（{e}）")

    # ---- 写 YAML：load → 改 db 段 → dump，保留其它段 ----
    cfg_path = get_config_path()
    raw: dict = {}
    if cfg_path.exists():
        try:
            with cfg_path.open("r", encoding="utf-8") as f:
                loaded = yaml.safe_load(f)
            if isinstance(loaded, dict):
                raw = loaded
        except yaml.YAMLError as e:
            raise HTTPException(500, f"现有 config.yaml 解析失败：{e}")

    # 删旧 db 段，重写（避免遗留的 mysql 字段干扰）
    raw.pop("db", None)
    raw["db"] = {
        "backend": "duckdb",
        "duckdb": {"path": stored},
    }

    # 原子写
    try:
        fd, tmp_name = tempfile.mkstemp(
            prefix=".config.", suffix=".yaml.tmp", dir=str(cfg_path.parent)
        )
    except OSError as e:
        raise HTTPException(500, f"无法创建临时文件：{e}")

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            yaml.safe_dump(raw, f, allow_unicode=True, sort_keys=False)
        os.replace(tmp_name, cfg_path)
    except Exception:
        # 清理临时文件
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise HTTPException(500, "写入 config.yaml 失败")

    return {
        "ok": True,
        "config_path": str(cfg_path),
        "backend": "duckdb",
        "duckdb": {"path": stored},
        "next_startup_path": stored,
    }
