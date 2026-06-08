"""DuckDB 连接 + schema 管理。

_DDL 是表结构的**单一来源**，docs/SCHEMA.md 保持与之同步。
"""
from __future__ import annotations

import os
import shutil
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterator

import duckdb

from trail_app.utils import get_db_path

# 全局写锁：DuckDB 单进程单连接即可，但跨线程需要互斥
_write_lock = threading.Lock()

# 全局只读模式：环境变量 TRAIL_READONLY=1 启用
READONLY = os.environ.get("TRAIL_READONLY", "").lower() in ("1", "true", "yes")


# ============================================================
# DDL（与 docs/SCHEMA.md 同步）
# ============================================================

_DDL: list[str] = [
    # 任务主表序列
    "CREATE SEQUENCE IF NOT EXISTS tasks_id_seq START 1",
    # 任务主表
    """
    CREATE TABLE IF NOT EXISTS tasks (
        id                  BIGINT PRIMARY KEY DEFAULT nextval('tasks_id_seq'),
        title               VARCHAR NOT NULL,
        alias               VARCHAR,
        description         VARCHAR,
        start_date          DATE,
        processing_date     DATE,
        end_date            DATE,
        status              VARCHAR NOT NULL,
        nature              VARCHAR NOT NULL,
        summary             VARCHAR,
        maintenance_summary VARCHAR,
        tags                VARCHAR[],
        original_title      VARCHAR,
        source              VARCHAR NOT NULL DEFAULT '任务需求.md',
        pinned_at           TIMESTAMP,
        created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    # 对接渠道子表
    "CREATE SEQUENCE IF NOT EXISTS contact_channels_id_seq START 1",
    """
    CREATE TABLE IF NOT EXISTS contact_channels (
        id          BIGINT PRIMARY KEY DEFAULT nextval('contact_channels_id_seq'),
        task_id     BIGINT NOT NULL,
        kind        VARCHAR NOT NULL,
        channel     VARCHAR NOT NULL,
        name        VARCHAR NOT NULL,
        target      VARCHAR,
        note        VARCHAR,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    # 工作日志
    """
    CREATE SEQUENCE IF NOT EXISTS work_logs_id_seq START 1
    """,
    """
    CREATE TABLE IF NOT EXISTS work_logs (
        id                BIGINT PRIMARY KEY DEFAULT nextval('work_logs_id_seq'),
        task_id           BIGINT NOT NULL,
        log_date          DATE NOT NULL,
        phase             VARCHAR NOT NULL DEFAULT 'main',
        ordinal           INTEGER NOT NULL DEFAULT 0,
        content           VARCHAR NOT NULL,
        polished_content  VARCHAR,
        is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_at        TIMESTAMP,
        updated_at        TIMESTAMP,
        edit_count        INTEGER NOT NULL DEFAULT 0,
        created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    # 大模型操作审计（M3 才用，建表先预备）
    """
    CREATE SEQUENCE IF NOT EXISTS ai_records_id_seq START 1
    """,
    """
    CREATE TABLE IF NOT EXISTS ai_records (
        id              BIGINT PRIMARY KEY DEFAULT nextval('ai_records_id_seq'),
        task_id         BIGINT,
        log_id          BIGINT,
        op              VARCHAR NOT NULL,
        prompt          VARCHAR,
        response        VARCHAR,
        user_confirmed  BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    # LLM 配置（加密存储）
    """
    CREATE TABLE IF NOT EXISTS llm_settings (
        key     VARCHAR PRIMARY KEY,
        value   VARCHAR NOT NULL
    )
    """,
    # 索引
    "CREATE INDEX IF NOT EXISTS idx_contact_channels_task  ON contact_channels(task_id)",
    "CREATE INDEX IF NOT EXISTS idx_work_logs_task         ON work_logs(task_id)",
    "CREATE INDEX IF NOT EXISTS idx_work_logs_date         ON work_logs(log_date)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_status           ON tasks(status)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_nature           ON tasks(nature)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_alias            ON tasks(alias)",
]


# ============================================================
# 连接管理
# ============================================================


@contextmanager
def get_connection(db_path: Path | None = None) -> Iterator[duckdb.DuckDBPyConnection]:
    """DuckDB 连接上下文管理器。

    使用方式：
        with get_connection() as con:
            con.execute(...)

    只读模式：环境变量 TRAIL_READONLY=1 时，所有连接以 read_only 打开。
    适合与 DBeaver 等工具共存时使用。
    """
    path = db_path or get_db_path()
    con = duckdb.connect(str(path), read_only=READONLY)
    try:
        yield con
    finally:
        con.close()


def ensure_schema(con: duckdb.DuckDBPyConnection) -> None:
    """按 _DDL 顺序执行，确保表/索引齐全；之后再补 work_logs / tasks 老库列 + 重建视图。"""
    for ddl in _DDL:
        con.execute(ddl)
    _ensure_work_logs_columns(con)
    _ensure_tasks_columns(con)
    _ensure_views(con)


def _ensure_work_logs_columns(con: duckdb.DuckDBPyConnection) -> None:
    """老库升级：work_logs 表缺新列时按需 ALTER 加上（保留数据）。

    DuckDB ALTER TABLE ADD COLUMN 不支持带 NOT NULL DEFAULT 约束，
    所以新列默认 NULL；add_log / update_log / delete_log 写入时显式 set 值。
    仅 work_logs 走这条路径（其它表用 ensure_schema 完整重建即可）。
    """
    additions = [
        ("is_deleted",   "ALTER TABLE work_logs ADD COLUMN is_deleted BOOLEAN"),
        ("deleted_at",   "ALTER TABLE work_logs ADD COLUMN deleted_at TIMESTAMP"),
        ("updated_at",   "ALTER TABLE work_logs ADD COLUMN updated_at TIMESTAMP"),
        ("edit_count",   "ALTER TABLE work_logs ADD COLUMN edit_count INTEGER"),
    ]
    for col, ddl in additions:
        if _column_type(con, "work_logs", col) is None:
            con.execute(ddl)
    # 老行把 is_deleted / edit_count 回填默认值（NULL 视作 FALSE / 0）
    con.execute("UPDATE work_logs SET is_deleted = FALSE WHERE is_deleted IS NULL")
    con.execute("UPDATE work_logs SET edit_count = 0 WHERE edit_count IS NULL")


def _ensure_tasks_columns(con: duckdb.DuckDBPyConnection) -> None:
    """老库升级：tasks 表缺新列时按需 ALTER 加上（保留数据）。

    同时建依赖新列的索引（必须在 ALTER 之后）。
    """
    additions = [
        ("pinned_at", "ALTER TABLE tasks ADD COLUMN pinned_at TIMESTAMP"),
    ]
    for col, ddl in additions:
        if _column_type(con, "tasks", col) is None:
            con.execute(ddl)
    # 依赖新列的索引，必须在 ALTER 加完列后建
    con.execute("CREATE INDEX IF NOT EXISTS idx_tasks_pinned ON tasks(pinned_at)")


_VIEW_DDL: list[str] = [
    """
    CREATE OR REPLACE VIEW v_stale_tasks AS
    SELECT
        t.id, t.title, t.status, t.nature,
        (SELECT MAX(log_date) FROM work_logs w WHERE w.task_id = t.id AND w.is_deleted = FALSE) AS last_log_date,
        CAST(CURRENT_DATE - (SELECT MAX(log_date) FROM work_logs w WHERE w.task_id = t.id AND w.is_deleted = FALSE) AS BIGINT) AS days_idle
    FROM tasks t
    WHERE t.status = '进行中'
    """,
]


def _ensure_views(con: duckdb.DuckDBPyConnection) -> None:
    """建/刷新视图。必须在 work_logs 升级列后再跑（v_stale_tasks 引用 is_deleted）。"""
    for ddl in _VIEW_DDL:
        con.execute(ddl)


def recreate_schema(con: duckdb.DuckDBPyConnection) -> None:
    """删表重建（--recreate 模式）。"""
    con.execute("DROP VIEW IF EXISTS v_stale_tasks")
    con.execute("DROP TABLE IF EXISTS ai_records")
    con.execute("DROP TABLE IF EXISTS work_logs")
    con.execute("DROP TABLE IF EXISTS contact_channels")
    con.execute("DROP TABLE IF EXISTS tasks")
    con.execute("DROP SEQUENCE IF EXISTS ai_records_id_seq")
    con.execute("DROP SEQUENCE IF EXISTS work_logs_id_seq")
    con.execute("DROP SEQUENCE IF EXISTS contact_channels_id_seq")
    con.execute("DROP SEQUENCE IF EXISTS tasks_id_seq")
    ensure_schema(con)


# ============================================================
# 旧 schema 一次性迁移（v2 重构：id 改 BIGINT / 拆 contact 表）
# ============================================================


def _column_type(con: duckdb.DuckDBPyConnection, table: str, column: str) -> str | None:
    """查某列类型；表/列不存在返回 None。"""
    try:
        rows = con.execute(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = ? AND column_name = ?",
            [table, column],
        ).fetchall()
    except duckdb.Error:
        return None
    if not rows:
        return None
    return rows[0][0]


def needs_legacy_migration(con: duckdb.DuckDBPyConnection) -> bool:
    """判断当前 DB 是否仍是旧 schema（tasks.id 是 VARCHAR）。

    任意一项不匹配就视为旧版：
    - tasks.id 不是 BIGINT
    - tasks.contact 列还在
    - contact_channels 表不存在
    """
    id_type = _column_type(con, "tasks", "id")
    has_contact = _column_type(con, "tasks", "contact") is not None
    has_channels = False
    try:
        con.execute("SELECT 1 FROM contact_channels LIMIT 1")
        has_channels = True
    except duckdb.Error:
        has_channels = False
    if id_type and "BIGINT" not in id_type.upper():
        return True
    if has_contact:
        return True
    if not has_channels:
        return True
    return False


def migrate_from_legacy(db_path: Path) -> bool:
    """检测到旧 schema 时：备份整个文件，删掉重建，返回 True。

    用户已经在 plan 中明确"不需要迁移现有数据"——所以直接备份后重建。
    备份文件：`data/tasks.duckdb.bak.YYYYMMDD-HHMMSS`。
    """
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = db_path.with_suffix(f".duckdb.bak.{ts}")
    shutil.copy2(db_path, backup)
    # 也备份 wal / tmp（DuckDB 可能有）
    for ext in (".wal", ".tmp"):
        p = db_path.with_suffix(ext)
        if p.exists():
            shutil.copy2(p, backup.with_suffix(ext))
    # 删原文件，下次连接 create 新 schema
    db_path.unlink()
    return True


def acquire_write_lock() -> threading.Lock:
    """返回写锁，跨线程写操作时使用。"""
    return _write_lock
