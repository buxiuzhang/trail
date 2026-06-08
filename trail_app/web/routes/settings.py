"""LLM 设置 API：读取/保存加密配置。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from trail_app.prompts import DEFAULT_CHAT_SYSTEM, TOOLS_DESC
from trail_app.store import LLMSettingsStore

router = APIRouter(prefix="/api/settings", tags=["settings"])


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
