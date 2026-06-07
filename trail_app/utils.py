"""通用工具：数据目录路径。"""
from __future__ import annotations

from pathlib import Path


# ============================================================
# 数据目录
# ============================================================

DATA_DIR_NAME = "trail"


def get_data_dir() -> Path:
    """运行时数据目录：<项目根>/data/。"""
    data_dir = Path(__file__).resolve().parent.parent / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def get_db_path() -> Path:
    """DuckDB 数据库文件路径。"""
    return get_data_dir() / "tasks.duckdb"


def get_config_path() -> Path:
    """配置文件路径。"""
    return get_config_path_or_none() or (get_data_dir() / "config.yaml")


def get_config_path_or_none() -> Path | None:
    """配置文件路径（不存在时返回 None）。"""
    p = get_data_dir() / "config.yaml"
    return p if p.exists() else None


def get_export_dir() -> Path:
    """md 导出目录。"""
    d = get_data_dir() / "export"
    d.mkdir(parents=True, exist_ok=True)
    return d
