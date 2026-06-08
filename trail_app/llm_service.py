"""大模型调用封装（M3）。

4 个函数都返回 `(text, prompt_text, response_raw)` 三元组：
- `text`：模型产出的纯文本（前端展示 + 用户落库）
- `prompt_text`：完整发出去的 prompt（含 system + user），写 ai_records 用
- `response_raw`：模型原始 response JSON 字符串，写 ai_records 用

调用方（路由层）负责：
- 调本函数拿到三元组
- 调前端前脱敏（api_key 不会出现，因为根本不会进 prompt）
- 调 LLM 写库前**等用户显式确认**（硬规则）
- 写 ai_records 时用 `prompt_text` + `response_raw`
"""
from __future__ import annotations

import json
from typing import Optional, Tuple

from trail_app.config import LLMConfig, get_llm_config
from trail_app.prompts import (
    ASK_MAINTENANCE_SYSTEM,
    ASK_MAINTENANCE_USER,
    POLISH_SYSTEM,
    POLISH_USER,
    SUMMARIZE_MAINTENANCE_SYSTEM,
    SUMMARIZE_MAINTENANCE_USER,
    SUMMARIZE_MAIN_SYSTEM,
    SUMMARIZE_MAIN_USER,
)


# ============================================================
# 异常
# ============================================================


class LLMNotConfigured(Exception):
    """未配置 LLM（缺 api_key）。"""


class LLMError(Exception):
    """LLM 调用失败（网络、余额、模型错误等）。"""


# ============================================================
# 客户端管理（lazy）
# ============================================================


_client = None
_client_cfg_key: Optional[tuple] = None


def _get_client():
    """获取 anthropic.Anthropic 客户端（按配置缓存）。

    兼容 MiniMax：MiniMax 用 Bearer 认证，需要显式设置 api_key 并通过
    default_headers 传 Authorization header。
    """
    global _client, _client_cfg_key
    import anthropic

    cfg = get_llm_config()
    if cfg is None:
        raise LLMNotConfigured("ANTHROPIC_API_KEY / MINIMAX_API_KEY 未设置")

    sig = (cfg.api_key, cfg.base_url)
    if _client is None or _client_cfg_key != sig:
        using_minimax = "minimax" in cfg.base_url.lower()
        if using_minimax:
            # MiniMax 用 Bearer 认证；不能同时传 api_key（否则 SDK 加 x-api-key 冲突）
            _client = anthropic.Anthropic(
                base_url=cfg.base_url,
                default_headers={"Authorization": f"Bearer {cfg.api_key}"},
            )
        else:
            _client = anthropic.Anthropic(api_key=cfg.api_key, base_url=cfg.base_url)
        _client_cfg_key = sig
    return _client, cfg


# ============================================================
# 内部 helper
# ============================================================


def _call(
    system: str,
    user: str,
    cfg: LLMConfig,
    client,
) -> Tuple[str, str, str]:
    """调 anthropic messages.create。

    支持 thinking block（MiniMax-M3 模型在 thinking content 里可能返回）。
    """
    prompt_text = f"[system]\n{system}\n\n[user]\n{user}"
    try:
        msg = client.messages.create(
            model=cfg.model,
            max_tokens=cfg.max_tokens,
            system=system,
            messages=[{"role": "user", "content": [{"type": "text", "text": user}]}],
        )
    except Exception as e:
        raise LLMError(f"LLM 调用失败：{e!r}") from e

    # 解析 content blocks：优先 text，否则拼接所有 block 的 text
    text_parts: list[str] = []
    thinking_parts: list[str] = []
    for block in msg.content:
        btype = getattr(block, "type", None)
        if btype == "text":
            text_parts.append(block.text)
        elif btype == "thinking":
            thinking_parts.append(getattr(block, "thinking", ""))
        else:
            # 兜底：未知 block
            t = getattr(block, "text", None)
            if t:
                text_parts.append(t)

    text = "".join(text_parts).strip()
    if not text and thinking_parts:
        # 极端：模型只输出 thinking（极少见），把 thinking 当 text 回传
        text = "\n\n".join(thinking_parts).strip()

    # 原始 response JSON：anthropic SDK 0.40+ 有 model_dump()
    try:
        raw = json.dumps(msg.model_dump(), ensure_ascii=False, default=str)
    except Exception:
        raw = f"<unserializable: {type(msg).__name__}>"

    return text, prompt_text, raw


def _call_chat(
    system: str,
    messages: list[dict],
    cfg: LLMConfig,
    client,
) -> Tuple[str, str, str]:
    """调 anthropic messages.create（多轮对话版）。

    与 _call 对称，区别是接受 messages 数组而非单个 user 字符串。
    """
    # 拼接完整 prompt 用于审计
    parts = [f"[system]\n{system}"]
    for i, m in enumerate(messages):
        parts.append(f"\n\n[{m['role']}]\n{m['content']}")
    prompt_text = "".join(parts)

    try:
        msg = client.messages.create(
            model=cfg.model,
            max_tokens=cfg.max_tokens,
            system=system,
            messages=[
                {"role": m["role"], "content": [{"type": "text", "text": m["content"]}]}
                for m in messages
            ],
        )
    except Exception as e:
        raise LLMError(f"LLM 调用失败：{e!r}") from e

    # 解析 content blocks（同 _call 逻辑）
    text_parts: list[str] = []
    thinking_parts: list[str] = []
    for block in msg.content:
        btype = getattr(block, "type", None)
        if btype == "text":
            text_parts.append(block.text)
        elif btype == "thinking":
            thinking_parts.append(getattr(block, "thinking", ""))
        else:
            t = getattr(block, "text", None)
            if t:
                text_parts.append(t)

    text = "".join(text_parts).strip()
    if not text and thinking_parts:
        text = "\n\n".join(thinking_parts).strip()

    try:
        raw = json.dumps(msg.model_dump(), ensure_ascii=False, default=str)
    except Exception:
        raw = f"<unserializable: {type(msg).__name__}>"

    return text, prompt_text, raw


def chat(
    messages: list[dict],
    context: str,
) -> Tuple[str, str, str]:
    """多轮对话，注入任务上下文。

    messages: [{"role": "user"|"assistant", "content": str}, ...]
    context: 任务概况字符串，注入 system prompt

    system prompt 来源：DB 设置 > 默认值（DEFAULT_CHAT_SYSTEM）。
    """
    client, cfg = _get_client()
    system = cfg.chat_system_prompt.format(context=context)
    return _call_chat(system, messages, cfg, client)


# ============================================================
# 公开 API
# ============================================================


def polish_text(content: str) -> Tuple[str, str, str]:
    """润色单段文本。

    用于：
    - 落档前：用户在 compose / 编辑表单里点「请求润色」
    - 落档后：写 work_logs.polished_content
    """
    client, cfg = _get_client()
    user = POLISH_USER.format(content=content.strip())
    return _call(POLISH_SYSTEM, user, cfg, client)


def summarize_main(title: str, date_range: str, logs: list[dict]) -> Tuple[str, str, str]:
    """主体阶段总结。

    logs: list of {log_date, content} dicts，按时间排好。
    """
    client, cfg = _get_client()
    body = "\n".join(
        f"[{l['log_date']}] {l['content']}" for l in logs
    )
    user = SUMMARIZE_MAIN_USER.format(title=title, date_range=date_range, logs=body)
    return _call(SUMMARIZE_MAIN_SYSTEM, user, cfg, client)


def summarize_maintenance(title: str, date_range: str, logs: list[dict]) -> Tuple[str, str, str]:
    """维护期总结。"""
    client, cfg = _get_client()
    body = "\n".join(
        f"[{l['log_date']}] {l['content']}" for l in logs
    )
    user = SUMMARIZE_MAINTENANCE_USER.format(title=title, date_range=date_range, logs=body)
    return _call(SUMMARIZE_MAINTENANCE_SYSTEM, user, cfg, client)


def ask_maintenance(title: str, status: str, logs: list[dict]) -> Tuple[str, str, str]:
    """问 LLM：建议进入维护期 / 直接关闭。"""
    client, cfg = _get_client()
    body = "\n".join(
        f"[{l['log_date']}] {l['content']}" for l in logs
    )
    user = ASK_MAINTENANCE_USER.format(title=title, status=status, logs=body)
    return _call(ASK_MAINTENANCE_SYSTEM, user, cfg, client)
