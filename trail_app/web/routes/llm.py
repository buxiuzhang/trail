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

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from trail_app.llm_service import (
    LLMError,
    LLMNotConfigured,
    ask_maintenance,
    polish_text,
    summarize_main,
    summarize_maintenance,
)
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
