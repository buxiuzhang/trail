"""DuckDB → md 导出脚本。

用法：
    python scripts/duckdb_to_md.py
    python scripts/duckdb_to_md.py --only-open
    python scripts/duckdb_to_md.py -o /path/to/out.md
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from trail_app.db import get_connection  # noqa: E402
from trail_app.md_io import export_to_md  # noqa: E402
from trail_app.utils import get_db_path, get_export_dir  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="把 DuckDB 数据导出为 md")
    parser.add_argument("--db", type=Path, default=None, help="duckdb 路径（默认：data/tasks.duckdb）")
    parser.add_argument("-o", "--output", type=Path, default=None, help="输出 md 路径（默认：data/export/任务需求-YYYY-MM-DD.md）")
    parser.add_argument("--only-open", action="store_true", help="仅导进行中/未开始")
    args = parser.parse_args()

    db_path = args.db or get_db_path()
    if db_path is None:
        print("❌ 当前 backend=mysql；脚本仅支持 DuckDB。请用 --db 显式指定 .duckdb 路径。", file=sys.stderr)
        return 2
    if not db_path.exists():
        print(f"❌ 数据库不存在：{db_path}", file=sys.stderr)
        return 2

    output = args.output or (get_export_dir() / f"任务需求-{date.today().isoformat()}.md")

    with get_connection(db_path) as con:
        n = export_to_md(con, output, only_open=args.only_open)

    print(f"✅ 已导出 {n} 个任务到 {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
