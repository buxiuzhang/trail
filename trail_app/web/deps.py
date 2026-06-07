"""依赖注入：store 实例。"""
from __future__ import annotations

from functools import lru_cache

from trail_app.store import (
    AiRecordStore,
    ContactStore,
    InsightStore,
    TaskStore,
    WorkLogStore,
)


@lru_cache(maxsize=1)
def task_store() -> TaskStore:
    return TaskStore()


@lru_cache(maxsize=1)
def work_log_store() -> WorkLogStore:
    return WorkLogStore()


@lru_cache(maxsize=1)
def contact_store() -> ContactStore:
    return ContactStore()


@lru_cache(maxsize=1)
def insight_store() -> InsightStore:
    return InsightStore()


@lru_cache(maxsize=1)
def ai_record_store() -> AiRecordStore:
    return AiRecordStore()
