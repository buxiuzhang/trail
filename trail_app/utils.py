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


def get_db_path() -> Path | None:
    """当前激活数据库的 DuckDB 文件路径。

    - backend=duckdb：用 db.duckdb.path（绝对路径直用；相对路径相对 <项目根>/data/）
    - backend=mysql：返 None（调用方应识别后报错；web 启动时由 lifespan 拦下）
    - 配置缺失 / 解析失败：兜底 DuckDB + data/tasks.duckdb

    旧用户（YAML 无 db: 段）走默认路径 = 旧绝对路径，**零迁移**。
    相对路径以 <项目根>/data/ 为基准（与旧 get_data_dir() 行为一致）。
    """
    # 函数内 import 避免与 config 的循环依赖（config 顶层 import utils）
    from trail_app.config import get_db_settings
    try:
        s = get_db_settings()
    except Exception:
        return get_data_dir() / "tasks.duckdb"

    if s.backend != "duckdb":
        return None

    p = Path(s.duckdb_path)
    return p if p.is_absolute() else get_data_dir() / p


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
