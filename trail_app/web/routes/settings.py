"""LLM 设置 API：读取/保存加密配置。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from trail_app.store import LLMSettingsStore

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/llm")
def get_llm_settings():
    """获取已保存的 LLM 配置（明文返回）。"""
    try:
        settings = LLMSettingsStore().get_all()
        return {
            "api_key": settings.get("api_key", ""),
            "base_url": settings.get("base_url", ""),
            "model": settings.get("model", ""),
            "max_tokens": settings.get("max_tokens", ""),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取配置失败：{e}")


@router.put("/llm")
def save_llm_settings(data: dict):
    """保存 LLM 配置（加密入库）。"""
    settings = {}
    for k in ("api_key", "base_url", "model", "max_tokens"):
        if k in data and data[k]:
            settings[k] = str(data[k]).strip()
    if not settings:
        raise HTTPException(status_code=400, detail="没有可保存的配置项")
    try:
        LLMSettingsStore().save(settings)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存配置失败：{e}")
