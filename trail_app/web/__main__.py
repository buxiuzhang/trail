"""python -m trail_app.web 入口：启动 uvicorn。"""
from __future__ import annotations

import argparse
import sys

import uvicorn


def main() -> int:
    parser = argparse.ArgumentParser(description="启动 Trail v2 Web 服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    uvicorn.run(
        "trail_app.web.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
