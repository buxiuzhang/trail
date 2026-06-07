"""md → DuckDB 导入脚本。

用法：
    python scripts/md_to_duckdb.py                  # 默认：跳过已存在
    python scripts/md_to_duckdb.py --recreate       # 清空重建
    python scripts/md_to_duckdb.py --md 其他.md --db x.duckdb
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# 让脚本能 import trail_app
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from trail_app.db import ensure_schema, get_connection, recreate_schema  # noqa: E402
from trail_app.md_io import import_to_db, parse_md  # noqa: E402
from trail_app.utils import get_db_path  # noqa: E402

DEFAULT_MD = ROOT / "任务需求.md"


def main() -> int:
    parser = argparse.ArgumentParser(description="把 `任务需求.md` 灌入 DuckDB")
    parser.add_argument("--md", type=Path, default=DEFAULT_MD, help=f"输入 md 路径（默认：{DEFAULT_MD}）")
    parser.add_argument("--db", type=Path, default=None, help="输出 duckdb 路径（默认：data/tasks.duckdb）")
    parser.add_argument("--recreate", action="store_true", help="先删表再重建（默认按 id 幂等追加）")
    args = parser.parse_args()

    if not args.md.exists():
        print(f"❌ md 文件不存在：{args.md}", file=sys.stderr)
        return 2

    db_path = args.db or get_db_path()
    source = args.md.name

    with get_connection(db_path) as con:
        if args.recreate:
            print("♻️  --recreate：删表重建")
            recreate_schema(con)
        else:
            ensure_schema(con)

        content = args.md.read_text(encoding="utf-8")
        parsed = parse_md(content)
        result = import_to_db(con, parsed, source)

        print(f"✅ 解析完成：新增 {len(result.imported)}，跳过 {len(result.skipped)}，报错 {len(result.errors)}")
        for title in result.imported:
            print(f"   ✓ {title}")
        for title in result.skipped:
            print(f"   ⏭  {title}（已存在）")
        for msg in result.errors:
            print(f"   ⚠️  {msg}")

        n_task = con.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        n_log = con.execute("SELECT COUNT(*) FROM work_logs").fetchone()[0]
        print()
        print(f"📦 {db_path}")
        print(f"   任务数：{n_task}")
        print(f"   日志数：{n_log}")

    return 0 if not result.errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
