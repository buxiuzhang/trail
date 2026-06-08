"""/api/llm/* 路由（M3）。

端点：
- `POST /api/llm/polish`  落档前润色（无 log 关联，写 ai_records）
- `POST /api/tasks/{id}/logs/{log_id}/polish`  落档后润色（写 polished_content + ai_records）
- `POST /api/tasks/{id}/summarize`  主体阶段总结
- `POST /api/tasks/{id}/maintenance/summarize`  维护期总结
- `POST /api/tasks/{id}/ask-maintenance`  询问是否进入维护期

**硬规则**：
- LLM 永不直写库。所有写库操作由前端在用户显式确认后二次请求触发。
- API key 不入 prompt / response / ai_records。
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from trail_app.llm_service import (
    LLMError,
    LLMNotConfigured,
    _get_client,
    ask_maintenance,
    chat,
    chat_stream,
    polish_text,
    summarize_main,
    summarize_maintenance,
)
from trail_app.prompts import DEFAULT_CHAT_SYSTEM
from trail_app.store import (
    AiRecordStore,
    NotFound,
    StoreError,
    TaskStore,
    WorkLogStore,
)
from trail_app.web.deps import (
    ai_record_store,
    task_store,
    work_log_store,
)

router = APIRouter(prefix="/api", tags=["llm"])


# ============================================================
# 通用 Pydantic 模型
# ============================================================


class PolishIn(BaseModel):
    content: str = Field(..., min_length=1)
    task_id: Optional[int] = None


class PolishOut(BaseModel):
    polished: str
    mock: bool = False


class SummarizeOut(BaseModel):
    text: str


class AskMaintenanceOut(BaseModel):
    suggestion: str  # "建议进入维护期" / "建议直接关闭" / 其它


# ============================================================
# 内部 helper
# ============================================================


def _date_range(logs: list[dict]) -> str:
    """给 LLM 看的日期范围描述。"""
    if not logs:
        return "无"
    dates = [l["log_date"] for l in logs]
    return f"{dates[0]} ~ {dates[-1]}（{len(dates)} 条）"


def _get_default_chat_system() -> str:
    """审计 fallback：DB 未配置聊天提示时用内置默认。"""
    return DEFAULT_CHAT_SYSTEM


def _collect_logs(
    task_id: int,
    phase: Optional[str],
    store: WorkLogStore,
) -> list[dict]:
    """取任务的日志列表（已软删过滤）。"""
    return [
        {"log_date": l["log_date"], "content": l["content"]}
        for l in store.list_logs(task_id, phase=phase)
    ]


# ============================================================
# 1) 落档前润色（无 log 关联）
# ============================================================


@router.post("/llm/polish", response_model=PolishOut)
def polish_compose(
    payload: PolishIn,
    records: AiRecordStore = Depends(ai_record_store),
):
    """落档前草稿润色。"""
    try:
        text, prompt, raw = polish_text(payload.content)
    except LLMNotConfigured as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    except LLMError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))

    if payload.task_id is not None:
        try:
            records.add_record(
                task_id=payload.task_id,
                log_id=None,
                op="polish",
                prompt=prompt,
                response=raw,
                user_confirmed=False,
            )
        except StoreError:
            pass  # 审计失败不阻塞主流程

    return PolishOut(polished=text, mock=False)


# ============================================================
# 2) 落档后润色（写 polished_content + ai_records）
# ============================================================


@router.post(
    "/tasks/{task_id}/logs/{log_id}/polish",
    response_model=PolishOut,
)
def polish_logged(
    task_id: int,
    log_id: int,
    records: AiRecordStore = Depends(ai_record_store),
    logs: WorkLogStore = Depends(work_log_store),
):
    """已落档日志的润色。返回润色版，前端让用户确认后再用 PUT 把 polished_content 写入。"""
    try:
        log = logs._get_log(log_id)
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))

    if log["task_id"] != task_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "日志不属于此任务")

    try:
        text, prompt, raw = polish_text(log["content"])
    except LLMNotConfigured as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    except LLMError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))

    records.add_record(
        task_id=task_id,
        log_id=log_id,
        op="polish",
        prompt=prompt,
        response=raw,
        user_confirmed=False,
    )

    return PolishOut(polished=text, mock=False)


# ============================================================
# 3) 主体阶段总结
# ============================================================


@router.post("/tasks/{task_id}/summarize", response_model=SummarizeOut)
def summarize_main_endpoint(
    task_id: int,
    tasks: TaskStore = Depends(task_store),
    logs: WorkLogStore = Depends(work_log_store),
    records: AiRecordStore = Depends(ai_record_store),
):
    try:
        task = tasks.get_task(task_id)
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))

    main_logs = _collect_logs(task_id, phase="main", store=logs)
    if not main_logs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "无主体阶段日志")

    try:
        text, prompt, raw = summarize_main(
            title=task["title"], date_range=_date_range(main_logs), logs=main_logs
        )
    except LLMNotConfigured as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    except LLMError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))

    records.add_record(
        task_id=task_id,
        log_id=None,
        op="summarize",
        prompt=prompt,
        response=raw,
        user_confirmed=False,
    )

    return SummarizeOut(text=text)


# ============================================================
# 4) 维护期总结
# ============================================================


@router.post(
    "/tasks/{task_id}/maintenance/summarize",
    response_model=SummarizeOut,
)
def summarize_maintenance_endpoint(
    task_id: int,
    tasks: TaskStore = Depends(task_store),
    logs: WorkLogStore = Depends(work_log_store),
    records: AiRecordStore = Depends(ai_record_store),
):
    try:
        task = tasks.get_task(task_id)
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))

    mt_logs = _collect_logs(task_id, phase="maintenance", store=logs)
    if not mt_logs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "无维护期日志")

    try:
        text, prompt, raw = summarize_maintenance(
            title=task["title"], date_range=_date_range(mt_logs), logs=mt_logs
        )
    except LLMNotConfigured as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    except LLMError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))

    records.add_record(
        task_id=task_id,
        log_id=None,
        op="summarize",
        prompt=prompt,
        response=raw,
        user_confirmed=False,
    )

    return SummarizeOut(text=text)


# ============================================================
# 5) 询问是否进入维护期
# ============================================================


@router.post(
    "/tasks/{task_id}/ask-maintenance",
    response_model=AskMaintenanceOut,
)
def ask_maintenance_endpoint(
    task_id: int,
    tasks: TaskStore = Depends(task_store),
    logs: WorkLogStore = Depends(work_log_store),
    records: AiRecordStore = Depends(ai_record_store),
):
    try:
        task = tasks.get_task(task_id)
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))

    main_logs = _collect_logs(task_id, phase="main", store=logs)
    if not main_logs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "无主体阶段日志")

    try:
        text, prompt, raw = ask_maintenance(
            title=task["title"], status=task["status"], logs=main_logs
        )
    except LLMNotConfigured as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    except LLMError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))

    records.add_record(
        task_id=task_id,
        log_id=None,
        op="ask_maintenance",
        prompt=prompt,
        response=raw,
        user_confirmed=False,
    )

    return AskMaintenanceOut(suggestion=text)


# ============================================================
# 6) 多轮对话（聊天气泡）
# ============================================================


class ChatMessage(BaseModel):
    role: str = Field(..., pattern=r"^(user|assistant)$")
    content: str = Field(..., min_length=1)


class ChatIn(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1)


class ChatOut(BaseModel):
    text: str


def _build_chat_context(
    tasks: TaskStore,
    logs: WorkLogStore,
) -> str:
    """构建聊天系统提示中的任务概况。

    返回一段中文文本，包含任务总数、状态分布、活跃任务及最近日志摘要。

    活跃判定：除「已作废」外，满足以下任一条件即视为活跃——
    - 状态为「进行中」/「维护中」（保持随时可能继续的传统活跃任务）
    - 状态为「未开始」（将来要做，LLM 也需要知道）
    - 最近 14 天内有日志更新（覆盖"已完成但还在改"的维护期尾部）

    这样可以避免：僵尸"进行中"任务没被剔除、已完成任务但本周还在改没
    出现在 context 里。
    """
    from datetime import date, timedelta

    ACTIVE_WINDOW_DAYS = 14
    today = date.today()
    window_start = today - timedelta(days=ACTIVE_WINDOW_DAYS)

    all_tasks = tasks.list_tasks()

    # 状态分布
    status_counts: dict[str, int] = {}
    for t in all_tasks:
        s = t["status"]
        status_counts[s] = status_counts.get(s, 0) + 1

    total = len(all_tasks)
    status_str = "、".join(f"{k} {v} 项" for k, v in status_counts.items())

    def _is_active(t: dict) -> bool:
        if t["status"] == "已作废":
            return False
        # 进行中 / 维护中 / 未开始 必定活跃
        if t["status"] in ("进行中", "维护中", "未开始"):
            return True
        # 已完成：看最近 14 天有无日志
        try:
            latest = logs.latest_log_date(t["id"])
        except Exception:
            latest = None
        return bool(latest and latest >= window_start)

    active = [t for t in all_tasks if _is_active(t)]
    active_lines: list[str] = []
    for t in active[:20]:  # 上限防 token 超
        task_logs = logs.list_logs(t["id"])
        recent = task_logs[-3:]
        recent_str = "; ".join(
            f"{l['log_date']}: {l['content'][:80]}" for l in recent
        )
        active_lines.append(
            f"- [{t['status']}] #{t['id']} {t['title']}"
            f"（最近日志: {recent_str or '无'}）"
        )

    lines = [
        f"任务总数: {total}。按状态: {status_str}。",
        f"活跃判定窗口: 最近 {ACTIVE_WINDOW_DAYS} 天内有日志更新，或状态为进行中/维护中/未开始。",
        "活跃任务:",
    ]
    lines.extend(active_lines if active_lines else ["（无活跃任务）"])
    return "\n".join(lines)


@router.post("/chat", response_model=ChatOut)
def chat_endpoint(
    payload: ChatIn,
    tasks: TaskStore = Depends(task_store),
    logs: WorkLogStore = Depends(work_log_store),
    records: AiRecordStore = Depends(ai_record_store),
):
    """多轮对话，注入任务上下文。

    前端传入完整消息历史（user/assistant 交替），
    后端拼入当前任务概况作为 system 提示，返回 LLM 回复。
    """
    context = _build_chat_context(tasks, logs)

    # 转换 Pydantic 模型为普通 dict
    messages = [{"role": m.role, "content": m.content} for m in payload.messages]

    try:
        text, prompt, raw = chat(messages, context)
    except LLMNotConfigured as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    except LLMError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))

    # 审计（异步友好，失败不阻塞）
    try:
        records.add_record(
            task_id=0,  # 对话不绑定特定任务
            log_id=None,
            op="chat",
            prompt=prompt,
            response=raw,
            user_confirmed=False,
        )
    except Exception:
        pass

    return ChatOut(text=text)


# ============================================================
# 7) 多轮对话流式版（SSE）
# ============================================================


@router.post("/chat/stream")
def chat_stream_endpoint(
    payload: ChatIn,
    tasks: TaskStore = Depends(task_store),
    logs: WorkLogStore = Depends(work_log_store),
    records: AiRecordStore = Depends(ai_record_store),
):
    """多轮对话流式版（SSE）。

    数据格式：
    - `data: {"delta":"文本片段"}\n\n`  每次 LLM 输出新 token
    - `data: {"done":true}\n\n`        流结束
    - `data: [DONE]\n\n`               关闭标记
    - `data: {"error":"..."}\n\n`      mid-stream 错误
    """
    # 预检：未配置时直接 503，不进入 stream
    try:
        _get_client()
    except LLMNotConfigured as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))

    context = _build_chat_context(tasks, logs)
    messages = [{"role": m.role, "content": m.content} for m in payload.messages]

    def gen():
        raw: str = ""
        full_text = ""
        try:
            for piece in chat_stream(messages, context):
                if isinstance(piece, tuple) and piece and piece[0] == "__final__":
                    _, full_text, raw = piece
                else:
                    yield f"data: {json.dumps({'delta': piece}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'done': True}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except LLMError as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': f'流式异常：{e!r}'}, ensure_ascii=False)}\n\n"
        else:
            # 审计：流正常结束后写 ai_records（失败不抛）
            try:
                _, cfg = _get_client()
                sys_prompt = (
                    cfg.chat_system_prompt
                    or _get_default_chat_system()
                ).format(context=context)
                prompt_text = f"[system]\n{sys_prompt}"
                for m in messages:
                    prompt_text += f"\n\n[{m['role']}]\n{m['content']}"
                records.add_record(
                    task_id=0,
                    log_id=None,
                    op="chat",
                    prompt=prompt_text,
                    response=raw,
                    user_confirmed=False,
                )
            except Exception:
                pass

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
