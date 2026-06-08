"""FastAPI 应用入口。"""
from __future__ import annotations

import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from trail_app.db import (
    ensure_schema,
    get_connection,
    migrate_from_legacy,
    needs_legacy_migration,
    recreate_schema,
)
from trail_app.utils import get_db_path
from trail_app.web.routes import insights, llm, logs, settings, tasks


# 前端构建产物目录（React Vite build）
# 可通过环境变量 TRAIL_FRONTEND_DIR 指定，或默认查找 trail_web/dist
_frontend_env = os.environ.get("TRAIL_FRONTEND_DIR")
if _frontend_env:
    FRONTEND_DIR = Path(_frontend_env)
else:
    _candidate = Path(__file__).parent.parent.parent.parent / "trail_web" / "dist"
    FRONTEND_DIR = _candidate if _candidate.exists() else None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时建表（只一次），避免后续并发请求的 DDL 冲突。

    若检测到旧 schema（tasks.id 是 VARCHAR / 旧 contact 列还在 / 没有 contact_channels 表），
    按用户要求"不保留现有数据"——备份原文件，删掉重建。
    """
    db_path = get_db_path()
    if db_path.exists():
        with get_connection() as con:
            if needs_legacy_migration(con):
                migrate_from_legacy(db_path)
    with get_connection() as con:
        ensure_schema(con)
    yield


app = FastAPI(
    title="Trail v2",
    description="任务填报 + 大模型辅助（M2 阶段：不含 LLM）",
    version="0.2.0",
    lifespan=lifespan,
)


# ============================================================
# 全局错误处理：DB 锁被占时返回 503 + 明确提示
# ============================================================

_LOCK_HINT_RE = re.compile(
    r"Conflicting lock is held in (?P<app>[^\s]+) \(PID (?P<pid>\d+)\)",
    re.IGNORECASE,
)


@app.exception_handler(Exception)
async def db_lock_handler(request: Request, exc: Exception):
    """捕获 DB 锁错误，返回 503 + 明确提示（而不是裸 500）。"""
    msg = str(exc)
    if "Could not set lock" in msg or "Conflicting lock" in msg:
        m = _LOCK_HINT_RE.search(msg)
        holder = f"{m.group('app')} (PID {m.group('pid')})" if m else "其他进程"
        return JSONResponse(
            status_code=503,
            content={
                "detail": (
                    f"数据库被 {holder} 占用（持写锁）。"
                    f"请在那个应用里断开 tasks.duckdb 连接后再试。"
                ),
                "lock_holder": m.group("app") if m else None,
            },
        )
    # 其他异常：原样返 500
    return JSONResponse(
        status_code=500,
        content={"detail": f"内部错误：{type(exc).__name__}: {msg}"},
    )


# API 路由
app.include_router(tasks.router)
app.include_router(logs.router)
app.include_router(insights.router)
app.include_router(llm.router)
app.include_router(settings.router)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": "0.2.0"}


# 显式提供静态文件（不挂 mount，避免拦截 /api/*）

# 优先使用 React 构建产物（trail_web/dist/）
if FRONTEND_DIR and FRONTEND_DIR.exists():
    # 挂载 assets/ 目录
    assets_dir = FRONTEND_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    # SPA 入口：非 /api/* 路径先查文件，不存在才回退 index.html
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        """SPA 回退：静态文件直接返，其它返回 index.html 让 React Router 处理。"""

        # 先检查 dist/ 下是否有同名文件（favicon.svg / chat.svg 等根级素材）
        root_dir = Path(FRONTEND_DIR)
        file_path = root_dir / full_path
        if file_path.is_file():
            import mimetypes
            mt, _ = mimetypes.guess_type(str(file_path))
            return FileResponse(file_path, media_type=mt or "application/octet-stream")

        index_path = root_dir / "index.html"
        if not index_path.exists():
            return JSONResponse({"detail": "前端未构建，请先运行 npm run build"}, status_code=503)
        return FileResponse(index_path, media_type="text/html")
