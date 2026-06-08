"""/api/tasks/* 路由。"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from trail_app.models import TaskStatus
from trail_app.store import (
    ContactStore,
    Duplicate,
    InvalidTransition,
    NotFound,
    StoreError,
    TaskStore,
)
from trail_app.web.deps import contact_store, task_store
from trail_app.web.schemas import (
    ContactOut,
    StatusChange,
    TaskCreate,
    TaskOut,
    TaskUpdate,
)

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _to_out(t: dict, contacts: list[dict]) -> TaskOut:
    """dict + contacts 列表 → TaskOut。"""
    out = {k: t.get(k) for k in TaskOut.model_fields if k != "contacts"}
    out["contacts"] = [ContactOut(**c) for c in contacts]
    return TaskOut(**out)


def _attach_contacts(
    tasks: list[dict],
    contacts_by_task: dict[int, list[dict]],
) -> list[TaskOut]:
    return [
        _to_out(t, contacts_by_task.get(t["id"], []))
        for t in tasks
    ]


@router.get("", response_model=list[TaskOut])
def list_tasks(
    status_filter: Optional[str] = Query(None, alias="status"),
    nature: Optional[str] = None,
    search: Optional[str] = None,
    store: TaskStore = Depends(task_store),
    contacts: ContactStore = Depends(contact_store),
):
    tasks = store.list_tasks(status_filter, nature, search)
    bulk = contacts.list_contacts_bulk([t["id"] for t in tasks])
    return _attach_contacts(tasks, bulk)


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    store: TaskStore = Depends(task_store),
    contacts: ContactStore = Depends(contact_store),
):
    try:
        created = store.create_task(
            title=payload.title,
            nature=payload.nature,
            alias=payload.alias,
            description=payload.description,
            start_date=payload.start_date.isoformat() if payload.start_date else None,
            processing_date=(
                payload.processing_date.isoformat() if payload.processing_date else None
            ),
            status=payload.status,
            tags=payload.tags,
        )
        if payload.contacts:
            contacts.set_contacts(
                created["id"], [c.model_dump() for c in payload.contacts]
            )
        # 回读带 contacts
        result = store.get_task(created["id"])
        return _to_out(result, contacts.list_contacts(result["id"]))
    except Duplicate as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    except StoreError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.get("/{task_id}", response_model=TaskOut)
def get_task(
    task_id: int,
    store: TaskStore = Depends(task_store),
    contacts: ContactStore = Depends(contact_store),
):
    try:
        t = store.get_task(task_id)
        return _to_out(t, contacts.list_contacts(task_id))
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))


@router.put("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    store: TaskStore = Depends(task_store),
    contacts: ContactStore = Depends(contact_store),
):
    fields: dict = {}
    for k in ("title", "alias", "description", "nature",
              "summary", "maintenance_summary", "tags"):
        v = getattr(payload, k)
        if v is not None:
            fields[k] = v
    for k in ("start_date", "processing_date", "end_date"):
        v = getattr(payload, k)
        if v is not None:
            fields[k] = v.isoformat()

    try:
        # status 走单独的状态机校验路径（不混进 update_task）
        if payload.status is not None and payload.status != "":
            end_date_str = (
                fields.get("end_date")
                or (payload.end_date.isoformat() if payload.end_date else None)
            )
            result = store.change_status(
                task_id, new_status=payload.status, end_date=end_date_str
            )
        else:
            result = store.update_task(task_id, **fields)
        if payload.contacts is not None:
            contacts.set_contacts(task_id, [c.model_dump() for c in payload.contacts])
        return _to_out(result, contacts.list_contacts(task_id))
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except Duplicate as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    except StoreError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.post("/{task_id}/status", response_model=TaskOut)
def change_status(
    task_id: int,
    payload: StatusChange,
    store: TaskStore = Depends(task_store),
    contacts: ContactStore = Depends(contact_store),
):
    if payload.new_status not in TaskStatus.all():
        raise HTTPException(400, f"非法状态：{payload.new_status}")
    try:
        updated = store.change_status(
            task_id,
            payload.new_status,
            end_date=payload.end_date.isoformat() if payload.end_date else None,
            maintenance=payload.maintenance,
        )
        # 同步写入 summary（如果传了）
        if payload.summary is not None and payload.new_status == TaskStatus.COMPLETED.value:
            updated = store.update_task(task_id, summary=payload.summary)
        return _to_out(updated, contacts.list_contacts(task_id))
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except InvalidTransition as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except StoreError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.post("/{task_id}/cancel", response_model=TaskOut)
def cancel_task(
    task_id: int,
    store: TaskStore = Depends(task_store),
    contacts: ContactStore = Depends(contact_store),
):
    try:
        updated = store.cancel_task(task_id)
        return _to_out(updated, contacts.list_contacts(task_id))
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except InvalidTransition as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    store: TaskStore = Depends(task_store),
):
    """硬删任务（连 contact_channels / work_logs / ai_records 一并清掉）。"""
    try:
        store.delete_task(task_id)
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    return None


@router.post("/{task_id}/pin", response_model=TaskOut)
def pin_task(
    task_id: int,
    store: TaskStore = Depends(task_store),
    contacts: ContactStore = Depends(contact_store),
):
    """置顶。幂等：已置顶再 pin 不改时间。"""
    try:
        return _to_out(store.pin(task_id), contacts.list_contacts(task_id))
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))


@router.post("/{task_id}/unpin", response_model=TaskOut)
def unpin_task(
    task_id: int,
    store: TaskStore = Depends(task_store),
    contacts: ContactStore = Depends(contact_store),
):
    """取消置顶。幂等：未置顶再 unpin 不报错。"""
    try:
        return _to_out(store.unpin(task_id), contacts.list_contacts(task_id))
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
