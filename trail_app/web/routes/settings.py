"""LLM 设置 + 卷首语 API：读取/保存配置。"""
from __future__ import annotations

import duckdb

from fastapi import APIRouter, HTTPException

from trail_app.prompts import DEFAULT_CHAT_SYSTEM, TOOLS_DESC
from trail_app.store import LLMSettingsStore
from trail_app.utils import get_db_path

router = APIRouter(prefix="/api/settings", tags=["settings"])

# 卷首语默认值（用户在 SettingsPage 可改）
DEFAULT_MOTTO = "凡录入者，皆为正典。\n凡未录者，皆为虚构。"


@router.get("/llm")
def get_llm_settings():
    """获取已保存的 LLM 配置（明文返回）。

    tools_desc 字段只读：5 工具的自然语言描述，前端编辑 prompt 时可
    参考。实际拼装由 llm_service._render_chat_system 完成（用户漏写
    {tools_desc} 占位符时末尾兜底追加）。
    """
    try:
        settings = LLMSettingsStore().get_all()
        return {
            "api_key": settings.get("api_key", ""),
            "base_url": settings.get("base_url", ""),
            "model": settings.get("model", ""),
            "max_tokens": settings.get("max_tokens", ""),
            "chat_system_prompt": settings.get("chat_system_prompt", "") or DEFAULT_CHAT_SYSTEM,
            "tools_desc": TOOLS_DESC,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取配置失败：{e}")


@router.put("/llm")
def save_llm_settings(data: dict):
    """保存 LLM 配置（加密入库）。

    对话提示词为空时删除该 key（回退默认值）。
    """
    settings = {}
    store = LLMSettingsStore()
    for k in ("api_key", "base_url", "model", "max_tokens", "chat_system_prompt"):
        if k not in data:
            continue
        v = str(data[k]).strip() if data[k] else ""
        if v:
            settings[k] = v
        elif k == "chat_system_prompt":
            # 空值 = 恢复默认，删除已保存的自定义提示词
            try:
                store.delete(k)
            except Exception:
                pass
    if not settings:
        raise HTTPException(status_code=400, detail="没有可保存的配置项")
    try:
        store.save(settings)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存配置失败：{e}")


# ============================================================
# 卷首语（明文存 llm_settings 表，key='motto'）
# ============================================================


def _motto_connect():
    p = get_db_path()
    if p is None:
        raise HTTPException(503, "当前数据后端不是 DuckDB，卷首语接口暂不可用。")
    return duckdb.connect(str(p))


@router.get("/motto")
def get_motto():
    """获取卷首语（侧栏底部那两行）。无值则返默认。"""
    try:
        con = _motto_connect()
        try:
            row = con.execute(
                "SELECT value FROM llm_settings WHERE key = 'motto'"
            ).fetchone()
        finally:
            con.close()
        return {"motto": row[0] if row else DEFAULT_MOTTO}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取卷首语失败：{e}")


@router.put("/motto")
def save_motto(data: dict):
    """保存卷首语。空值 = 恢复默认。"""
    raw = (data.get("motto") or "").strip()
    con = _motto_connect()
    try:
        if not raw:
            con.execute("DELETE FROM llm_settings WHERE key = 'motto'")
            return {"ok": True, "motto": DEFAULT_MOTTO}
        con.execute(
            "INSERT OR REPLACE INTO llm_settings (key, value) VALUES ('motto', ?)",
            [raw],
        )
        return {"ok": True, "motto": raw}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存卷首语失败：{e}")
    finally:
        con.close()
