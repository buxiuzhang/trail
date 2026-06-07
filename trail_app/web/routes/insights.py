"""/api/insights/* 路由（盘点、总览）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from trail_app.store import InsightStore
from trail_app.web.deps import insight_store
from trail_app.web.schemas import OverviewOut, StaleOut

router = APIRouter(prefix="/api/insights", tags=["insights"])


@router.get("/overview", response_model=OverviewOut)
def overview(store: InsightStore = Depends(insight_store)) -> OverviewOut:
    return OverviewOut(**store.overview())


@router.get("/stale", response_model=list[StaleOut])
def stale(
    idle_days: int = 30, store: InsightStore = Depends(insight_store)
) -> list[StaleOut]:
    return [StaleOut(**r) for r in store.stale_tasks(idle_days)]
