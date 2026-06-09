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


def chat_stream(
    messages: list[dict],
    context: str,
):
    """多轮对话的流式版本。生成器，每个 text_delta 片段 yield 一次。

    最后 yield 一个三元组 ("__final__", full_text, raw_json) 供审计使用。
    出错抛 LLMError。
    """
    from trail_app.config import LLMConfig as _LC
    client, cfg = _get_client()
    if not isinstance(cfg, _LC):
        cfg = _LC(**cfg)  # 防御性，正常情况 cfg 就是 LLMConfig
    system = cfg.chat_system_prompt.format(context=context)
    api_messages = [
        {"role": m["role"], "content": [{"type": "text", "text": m["content"]}]}
        for m in messages
    ]

    text_parts: list[str] = []
    try:
        with client.messages.stream(
            model=cfg.model,
            max_tokens=cfg.max_tokens,
            system=system,
            messages=api_messages,
        ) as stream:
            for event in stream:
                etype = getattr(event, "type", None)
                if etype == "content_block_delta":
                    delta = getattr(event, "delta", None)
                    if getattr(delta, "type", None) == "text_delta":
                        piece = getattr(delta, "text", "") or ""
                        if piece:
                            text_parts.append(piece)
                            yield piece
            final = stream.get_final_message()
            try:
                raw = json.dumps(final.model_dump(), ensure_ascii=False, default=str)
            except Exception:
                raw = f"<unserializable: {type(final).__name__}>"
    except Exception as e:
        raise LLMError(f"LLM 调用失败：{e!r}") from e

    yield ("__final__", "".join(text_parts).strip(), raw)


# ============================================================
# Tool use 基础设施（chat 重构）
# ============================================================


# Anthropic 协议的工具定义（结构化 JSON Schema）。
# Anthropic SDK 0.105 接受 dict 形式作为 tools 参数。
TOOLS: list[dict] = [
    {
        "name": "list_tasks",
        "description": "查询任务列表。可按 status/nature/search 过滤。上限 20 条。",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["未开始", "进行中", "已完成", "已作废"],
                    "description": "按状态过滤",
                },
                "nature": {
                    "type": "string",
                    "enum": ["业务", "技术", "会议", "其他"],
                    "description": "按性质过滤",
                },
                "search": {
                    "type": "string",
                    "description": "标题模糊匹配（中文子串）",
                },
            },
        },
    },
    {
        "name": "list_logs_by_date",
        "description": (
            "查某天（YYYY-MM-DD）的所有工作日志，按 task 分组（带任务标题/状态/性质）。"
            "适合'今日/今天/昨天工作内容'类问题。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "log_date": {
                    "type": "string",
                    "description": "YYYY-MM-DD，如 2026-06-09",
                },
                "phase": {
                    "type": "string",
                    "enum": ["main", "maintenance"],
                    "description": "可选：按阶段过滤",
                },
            },
            "required": ["log_date"],
        },
    },
    {
        "name": "list_recent_logs",
        "description": (
            "查某任务的近期工作日志。content 字段截断 800 字。"
            "适合「最近干了啥」类问题。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer", "description": "任务 ID"},
                "since_days": {
                    "type": "integer",
                    "default": 30,
                    "description": "只看最近 N 天的日志",
                },
                "limit": {
                    "type": "integer",
                    "default": 5,
                    "maximum": 20,
                    "description": "最多返多少条",
                },
                "phase": {
                    "type": "string",
                    "enum": ["main", "maintenance"],
                    "description": "按阶段过滤",
                },
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "get_task_detail",
        "description": (
            "查某任务完整信息：标题、别名、状态、起止日期、性质、"
            "summary、maintenance_summary、tags、contacts。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer", "description": "任务 ID"},
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "count_tasks_by_status",
        "description": (
            "返任务总数、按状态分组计数、按性质分组计数。"
            "适合「一共多少任务」类问题。"
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "ask_maintenance_suggestion",
        "description": (
            "让 LLM 评估某任务是否进入维护期。**不改库**，仅返建议文本。"
            "logs 可选传入预读日志，否则内部自取。"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer", "description": "任务 ID"},
                "logs": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "log_date": {"type": "string"},
                            "content": {"type": "string"},
                        },
                    },
                    "description": "可选：预读日志，否则内部自取",
                },
            },
            "required": ["task_id"],
        },
    },
]


class _BlockBuilder:
    """流式累积一个 content block 的元数据。

    用途：在 content_block_start 时新建；input_json_delta 时累积 partial_json；
    最终从 input_buf json.loads 还原成 input dict。
    """

    __slots__ = ("id", "name", "input_buf")

    def __init__(self, id: str, name: str, input_buf: str = ""):
        self.id = id
        self.name = name
        self.input_buf = input_buf


def _render_chat_system(user_prompt: str) -> str:
    """用户自定义 chat system prompt 拼上 {tools_desc} 描述 + 注入当前日期。

    双轨：
    - 用户 prompt 含 {tools_desc} 占位符 → 替换
    - 不含 → 末尾追加（兜底，避免用户漏写导致 LLM 不知道有工具可用）

    顶部拼"当前时间"块：让 LLM 在用户问"今天/今日/昨天"时直接用 {today}，
    避免 LLM 自己猜错日期。
    """
    from datetime import date, timedelta
    from trail_app.prompts import TOOLS_DESC

    today = date.today()
    yesterday = today - timedelta(days=1)
    weekday_cn = ["一", "二", "三", "四", "五", "六", "日"][today.weekday()]
    now_block = (
        f"当前时间信息（请直接用以下日期，不要自己猜测）：\n"
        f"- 今天：{today.isoformat()}（星期{weekday_cn}）\n"
        f"- 昨天：{yesterday.isoformat()}\n\n"
    )

    if "{tools_desc}" in user_prompt:
        rendered = user_prompt.format(tools_desc=TOOLS_DESC)
    else:
        rendered = user_prompt.rstrip() + "\n\n" + TOOLS_DESC
    return now_block + rendered


def _execute_tool(
    name: str,
    input_data: dict,
    *,
    task_store,
    work_log_store,
    insight_store,
) -> str:
    """执行一个工具调用，返 JSON 字符串作为 tool_result.content。

    异常：抛 ValueError / NotFound / StoreError → 调用方转 is_error=true。
    """
    from trail_app.models import LogPhase
    from trail_app.store import NotFound

    if name == "list_tasks":
        tasks = task_store.list_tasks(
            status=input_data.get("status"),
            nature=input_data.get("nature"),
            search=input_data.get("search"),
        )
        return json.dumps(tasks[:20], ensure_ascii=False, default=str)

    if name == "list_logs_by_date":
        log_date = input_data["log_date"]
        phase = input_data.get("phase")
        params = [log_date]
        sql = (
            "SELECT w.log_date, w.phase, w.ordinal, w.content, "
            "       t.id AS task_id, t.title, t.status, t.nature "
            "FROM work_logs w JOIN tasks t ON t.id = w.task_id "
            "WHERE w.log_date = ? AND w.is_deleted = FALSE"
        )
        if phase:
            sql += " AND w.phase = ?"
            params.append(phase)
        sql += " ORDER BY w.task_id, w.ordinal"
        from trail_app.db import get_connection
        with get_connection() as con:
            rows = con.execute(sql, params).fetchall()
        # 按 task 分组
        grouped: dict[int, dict] = {}
        for r in rows:
            log_date_v, phase_v, ordinal, content, task_id, title, status, nature = r
            if task_id not in grouped:
                grouped[task_id] = {
                    "task_id": task_id,
                    "title": title,
                    "status": status,
                    "nature": nature,
                    "logs": [],
                }
            grouped[task_id]["logs"].append({
                "log_date": log_date_v,
                "phase": phase_v,
                "ordinal": ordinal,
                "content": content,
            })
        return json.dumps(list(grouped.values()), ensure_ascii=False, default=str)

    if name == "list_recent_logs":
        task_id = int(input_data["task_id"])
        since_days = input_data.get("since_days")
        limit = input_data.get("limit")
        phase = input_data.get("phase")
        # phase 值要兼容 "main"/"maintenance"
        logs = work_log_store.list_logs(
            task_id=task_id,
            phase=phase,
            since_days=since_days,
            limit=limit,
        )
        # 单条 content 截断 800 字
        truncated = []
        for l in logs:
            d = dict(l)
            if d.get("content") and len(d["content"]) > 800:
                d["content"] = d["content"][:800] + "…"
            truncated.append(d)
        return json.dumps(truncated, ensure_ascii=False, default=str)

    if name == "get_task_detail":
        task_id = int(input_data["task_id"])
        task = task_store.get_task(task_id)
        return json.dumps(task, ensure_ascii=False, default=str)

    if name == "count_tasks_by_status":
        return json.dumps(
            insight_store.overview(), ensure_ascii=False, default=str
        )

    if name == "ask_maintenance_suggestion":
        task_id = int(input_data["task_id"])
        task = task_store.get_task(task_id)
        # 优先用 LLM 预传的 logs，否则内部自取主体阶段最近 10 条
        logs = input_data.get("logs")
        if not logs:
            logs = work_log_store.list_logs(
                task_id=task_id, phase=LogPhase.MAIN.value, limit=10
            )
        log_dicts = [
            {"log_date": l["log_date"], "content": l["content"]} for l in logs
        ]
        text, _, _ = ask_maintenance(
            title=task["title"],
            status=task["status"],
            logs=log_dicts,
        )
        return json.dumps({"suggestion": text}, ensure_ascii=False)

    raise ValueError(f"未知工具：{name}")


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


# ============================================================
# Tool use 多轮 chat（流式 + 同步两个版本）
# ============================================================


# 流式生成器 yield 的元组类型：
#   ("text", str)                  — 模型文本片段（推前端）
#   ("tool_call", {name, input})   — 工具调用开始
#   ("tool_result", {name, ok})    — 工具执行完（OK / 异常）
#   ("__final__", full_text, raw)  — 整轮结束，full_text 是拼接所有 text，
#                                    raw 是最后一条 final message 的 JSON 序列化


MAX_TOOL_ITERATIONS = 3


def _to_api_messages(messages: list[dict]) -> list[dict]:
    """把前端的 {"role","content":str} 序列化成 Anthropic API 格式。

    Anthropic 多轮 messages 里 user/assistant 的 content 是 list[block]，
    单条字符串要包成 [{"type":"text","text":...}]。
    """
    out: list[dict] = []
    for m in messages:
        content = m["content"]
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        out.append({"role": m["role"], "content": content})
    return out


def chat_stream_with_tools(
    messages: list[dict],
    *,
    task_store,
    work_log_store,
    insight_store,
    max_iterations: int = MAX_TOOL_ITERATIONS,
):
    """多轮 tool use 循环流式 chat。yield 协议见模块顶部注释。

    实现要点：
    - 用 client.messages.stream(..., tools=TOOLS) 单次 stream 内同时产
      text_delta 和 input_json_delta
    - text_delta 直接 yield；input_json_delta 累积到 _BlockBuilder
    - 每轮结束看 stop_reason：tool_use → 执行工具 + 回填下一轮；end_turn
      → 结束
    - cap=max_iterations 截断；中间不报错
    - 单工具异常走 is_error=true 回填 LLM，让 LLM 自己决定怎么回
    """
    client, cfg = _get_client()
    sys_prompt = _render_chat_system(cfg.chat_system_prompt)
    api_messages = _to_api_messages(messages)

    text_parts: list[str] = []
    raw: str = ""

    for iteration in range(max_iterations):
        block_builders: dict = {}
        round_text: list[str] = []
        try:
            with client.messages.stream(
                model=cfg.model,
                max_tokens=cfg.max_tokens,
                system=sys_prompt,
                tools=TOOLS,
                messages=api_messages,
            ) as stream:
                for event in stream:
                    etype = getattr(event, "type", None)
                    if etype == "content_block_start":
                        idx = getattr(event, "index", None)
                        cb = getattr(event, "content_block", None)
                        if cb is not None and getattr(cb, "type", None) == "tool_use":
                            block_builders[idx] = _BlockBuilder(
                                id=getattr(cb, "id", ""),
                                name=getattr(cb, "name", ""),
                            )
                    elif etype == "content_block_delta":
                        idx = getattr(event, "index", None)
                        delta = getattr(event, "delta", None)
                        dtype = getattr(delta, "type", None)
                        if dtype == "text_delta":
                            piece = getattr(delta, "text", "") or ""
                            if piece:
                                round_text.append(piece)
                                text_parts.append(piece)
                                yield ("text", piece)
                        elif dtype == "input_json_delta":
                            b = block_builders.get(idx)
                            if b is not None:
                                b.input_buf += getattr(delta, "partial_json", "") or ""
                    # content_block_stop / message_stop 等不需要处理

                final = stream.get_final_message()
                try:
                    raw = json.dumps(
                        final.model_dump(), ensure_ascii=False, default=str
                    )
                except Exception:
                    raw = f"<unserializable: {type(final).__name__}>"
        except Exception as e:
            raise LLMError(f"LLM 调用失败：{e!r}") from e

        # 收尾：把所有 tool_use block 的 input 解析成 dict
        tool_uses: list[dict] = []
        for block in final.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            idx = getattr(block, "index", None)
            builder = block_builders.get(idx)
            if builder is not None and builder.input_buf:
                try:
                    input_dict = json.loads(builder.input_buf)
                except Exception:
                    input_dict = {}
            else:
                # 兜底：直接从 block 取（不走流式累积的场景）
                input_dict = getattr(block, "input", None) or {}
            tool_uses.append(
                {
                    "id": getattr(block, "id", ""),
                    "name": getattr(block, "name", ""),
                    "input": input_dict,
                }
            )

        stop_reason = getattr(final, "stop_reason", None)
        if stop_reason != "tool_use" or not tool_uses:
            break  # end_turn / max_tokens / 无 tool_use，结束

        # 把本轮 assistant 完整 content 回填到 messages
        api_messages.append(
            {
                "role": "assistant",
                "content": [
                    b.model_dump() if hasattr(b, "model_dump") else b
                    for b in final.content
                ],
            }
        )

        # 执行工具
        tool_results: list[dict] = []
        for tu in tool_uses:
            yield (
                "tool_call",
                {"name": tu["name"], "input": tu["input"]},
            )
            try:
                result_text = _execute_tool(
                    tu["name"],
                    tu["input"],
                    task_store=task_store,
                    work_log_store=work_log_store,
                    insight_store=insight_store,
                )
                ok = True
            except Exception as e:
                result_text = (
                    f"工具执行失败：{type(e).__name__}: {e}"
                )
                ok = False
            yield ("tool_result", {"name": tu["name"], "ok": ok})
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": result_text,
                    "is_error": not ok,
                }
            )

        api_messages.append({"role": "user", "content": tool_results})

    yield ("__final__", "".join(text_parts).strip(), raw)


def _call_chat_tools(
    messages: list[dict],
    *,
    task_store,
    work_log_store,
    insight_store,
    max_iterations: int = MAX_TOOL_ITERATIONS,
) -> Tuple[str, str, str]:
    """同步版 tool use chat（/api/chat 旧端点用）。

    走 client.messages.create 不开 stream；多轮直到 end_turn 或 cap。
    返 (text, prompt_text, raw)。
    """
    client, cfg = _get_client()
    sys_prompt = _render_chat_system(cfg.chat_system_prompt)
    api_messages = _to_api_messages(messages)

    text_parts: list[str] = []
    raw: str = ""

    for _ in range(max_iterations):
        try:
            msg = client.messages.create(
                model=cfg.model,
                max_tokens=cfg.max_tokens,
                system=sys_prompt,
                tools=TOOLS,
                messages=api_messages,
            )
        except Exception as e:
            raise LLMError(f"LLM 调用失败：{e!r}") from e

        try:
            raw = json.dumps(msg.model_dump(), ensure_ascii=False, default=str)
        except Exception:
            raw = f"<unserializable: {type(msg).__name__}>"

        # 解析 content
        for block in msg.content:
            btype = getattr(block, "type", None)
            if btype == "text":
                t = getattr(block, "text", "") or ""
                if t:
                    text_parts.append(t)

        stop_reason = getattr(msg, "stop_reason", None)
        if stop_reason != "tool_use":
            break

        # 收集 tool_use + 回填
        tool_uses: list[dict] = []
        for block in msg.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            tool_uses.append(
                {
                    "id": getattr(block, "id", ""),
                    "name": getattr(block, "name", ""),
                    "input": getattr(block, "input", None) or {},
                }
            )
        if not tool_uses:
            break

        api_messages.append(
            {
                "role": "assistant",
                "content": [
                    b.model_dump() if hasattr(b, "model_dump") else b
                    for b in msg.content
                ],
            }
        )

        tool_results: list[dict] = []
        for tu in tool_uses:
            try:
                result_text = _execute_tool(
                    tu["name"],
                    tu["input"],
                    task_store=task_store,
                    work_log_store=work_log_store,
                    insight_store=insight_store,
                )
                is_error = False
            except Exception as e:
                result_text = (
                    f"工具执行失败：{type(e).__name__}: {e}"
                )
                is_error = True
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": result_text,
                    "is_error": is_error,
                }
            )
        api_messages.append({"role": "user", "content": tool_results})

    prompt_text = f"[system]\n{sys_prompt}"
    return "".join(text_parts).strip(), prompt_text, raw

