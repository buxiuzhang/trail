"""/api/tasks/:id/logs/* 路由。"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from trail_app.store import NotFound, StoreError, WorkLogStore
from trail_app.web.deps import work_log_store
from trail_app.web.schemas import LogCreate, LogOut, LogUpdate

router = APIRouter(prefix="/api/tasks/{task_id}/logs", tags=["logs"])


def _to_out(row: dict) -> LogOut:
    return LogOut(**{k: row.get(k) for k in LogOut.model_fields})


@router.get("", response_model=list[LogOut])
def list_logs(
    task_id: int,
    phase: Optional[str] = None,
    include_deleted: bool = False,
    store: WorkLogStore = Depends(work_log_store),
):
    try:
        return [_to_out(r) for r in store.list_logs(task_id, phase, include_deleted)]
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))


@router.post("", response_model=LogOut, status_code=status.HTTP_201_CREATED)
def add_log(
    task_id: int,
    payload: LogCreate,
    store: WorkLogStore = Depends(work_log_store),
):
    try:
        return _to_out(
            store.add_log(
                task_id=task_id,
                log_date=payload.log_date.isoformat(),
                content=payload.content,
                phase=payload.phase,
            )
        )
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except StoreError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.put("/{log_id}", response_model=LogOut)
def update_log(
    task_id: int,
    log_id: int,
    payload: LogUpdate,
    store: WorkLogStore = Depends(work_log_store),
):
    try:
        return _to_out(
            store.update_log(
                log_id=log_id,
                task_id=task_id,
                content=payload.content,
                log_date=payload.log_date.isoformat() if payload.log_date else None,
                phase=payload.phase,
            )
        )
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except StoreError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_log(
    task_id: int,
    log_id: int,
    hard: bool = False,
    store: WorkLogStore = Depends(work_log_store),
):
    try:
        store.delete_log(log_id=log_id, task_id=task_id, hard=hard)
    except NotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except StoreError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
