#!/usr/bin/env python3
"""DuckDB → SQLite 数据迁移（M8 一次性脚本）。

从 trail_app 旧 DuckDB 读取数据，写入 trail_api 新 SQLite。
转换规则：
  - VARCHAR[] → JSON 字符串（tasks.tags）
  - BOOLEAN   → INTEGER 0/1（work_logs.is_deleted / ai_records.user_confirmed）
  - TIMESTAMP / DATE → TEXT（ISO 8601 / YYYY-MM-DD）
  - 主键 id 原样保留（SQLite AUTOINCREMENT 会接在后面）
"""

import json
import sys
from datetime import date, datetime
from pathlib import Path

try:
    import duckdb
    import sqlite3
except ImportError as e:
    print(f"缺少依赖: {e}")
    print("pip install duckdb  (sqlite3 内置)")
    sys.exit(1)

DUCKDB_PATH = Path(__file__).resolve().parent.parent / "data" / "tasks.duckdb"
SQLITE_PATH = Path.home() / ".trail" / "data" / "tasks.sqlite"


def to_text(val):
    """将 DuckDB 返回值转为 SQLite TEXT 兼容字符串。"""
    if val is None:
        return None
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, bool):
        return 1 if val else 0
    if isinstance(val, list):
        return json.dumps(val, ensure_ascii=False)
    return val


def migrate_table(duck_con, sqlite_con, table: str, columns: list[str], pk: str = "id"):
    """逐行读取 DuckDB → 逐行写入 SQLite（幂等：冲突时更新）。"""
    col_list = ", ".join(columns)
    rows = duck_con.execute(f"SELECT {col_list} FROM {table} ORDER BY {pk}").fetchall()
    if not rows:
        print(f"  {table}: 0 行，跳过")
        return

    placeholders = ", ".join(["?" for _ in columns])
    col_names = ", ".join(columns)
    # SQLite 的 INSERT OR REPLACE 按主键幂等
    sql = f"INSERT OR REPLACE INTO {table} ({col_names}) VALUES ({placeholders})"

    count = 0
    for row in rows:
        values = [to_text(v) for v in row]
        sqlite_con.execute(sql, values)
        count += 1

    sqlite_con.commit()
    print(f"  {table}: {count} 行 ✓")


def main():
    if not DUCKDB_PATH.exists():
        print(f"源文件不存在: {DUCKDB_PATH}")
        sys.exit(1)
    if not SQLITE_PATH.exists():
        print(f"目标文件不存在: {SQLITE_PATH}")
        print("请先启动 trail-api 初始化 SQLite 数据库")
        sys.exit(1)

    print(f"源: {DUCKDB_PATH}  ({DUCKDB_PATH.stat().st_size / 1024:.0f} KB)")
    print(f"目标: {SQLITE_PATH}  ({SQLITE_PATH.stat().st_size / 1024:.0f} KB)")
    print()

    duck_con = duckdb.connect(str(DUCKDB_PATH))
    sqlite_con = sqlite3.connect(str(SQLITE_PATH))

    try:
        # 按 FK 依赖顺序：主表先，子表后。llm_settings 无依赖。
        # 不迁移 v_stale_tasks（视图，SQLite 启动时 ensureSchema 自动创建）

        print("--- 主表 ---")
        migrate_table(duck_con, sqlite_con, "tasks", [
            "id", "title", "alias", "description",
            "start_date", "processing_date", "end_date",
            "status", "nature", "summary", "maintenance_summary",
            "tags", "original_title", "source",
            "pinned_at", "created_at", "updated_at",
        ])

        print("--- 子表 ---")
        migrate_table(duck_con, sqlite_con, "contact_channels", [
            "id", "task_id", "kind", "channel", "name", "target", "note", "created_at",
        ])

        migrate_table(duck_con, sqlite_con, "work_logs", [
            "id", "task_id", "log_date", "phase", "ordinal",
            "content", "polished_content",
            "is_deleted", "deleted_at", "updated_at", "edit_count", "created_at",
        ])

        migrate_table(duck_con, sqlite_con, "ai_records", [
            "id", "task_id", "log_id", "op", "prompt", "response",
            "user_confirmed", "created_at",
        ])

        print("--- 配置 ---")
        migrate_table(duck_con, sqlite_con, "llm_settings", [
            "key", "value",
        ], pk="key")

        print()
        print(f"迁移完成。SQLite 大小: {SQLITE_PATH.stat().st_size / 1024:.0f} KB")

        # 验证行数
        print()
        print("=== 行数验证 ===")
        for t in ["tasks", "contact_channels", "work_logs", "ai_records", "llm_settings"]:
            duck_cnt = duck_con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            sql_cnt = sqlite_con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()
            if sql_cnt:
                sql_cnt = sql_cnt[0]
            ok = "✓" if duck_cnt == sql_cnt else "✗ 不一致!"
            print(f"  {t:20s}  DuckDB={duck_cnt:3d}  SQLite={sql_cnt}  {ok}")

    finally:
        duck_con.close()
        sqlite_con.close()


if __name__ == "__main__":
    main()
