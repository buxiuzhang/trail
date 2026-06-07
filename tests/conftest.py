"""pytest 共享 fixture。"""
from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from trail_app.db import ensure_schema, recreate_schema


@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    """临时 DuckDB 文件路径。"""
    return tmp_path / "test.duckdb"


@pytest.fixture
def fresh_db(tmp_db: Path) -> Path:
    """建好空 schema 的临时 DB。"""
    con = duckdb.connect(str(tmp_db))
    try:
        recreate_schema(con)
    finally:
        con.close()
    return tmp_db


@pytest.fixture
def con(fresh_db: Path) -> duckdb.DuckDBPyConnection:
    """已经建好 schema 的 DuckDB 连接。"""
    c = duckdb.connect(str(fresh_db))
    try:
        yield c
    finally:
        c.close()
