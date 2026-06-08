"""Pydantic 请求/响应模型。"""
from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel, Field

from trail_app.models import (
    ChannelKind,
    ChannelPlatform,
    LogPhase,
    TaskNature,
    TaskStatus,
)


# ============================================================
# 对接渠道
# ============================================================


class ContactIn(BaseModel):
    kind: str = Field(..., description="group/person/email/phone/other")
    channel: str = Field(..., description="dingtalk/wechat/elink/lark/feishu/email/phone/other")
    name: str = Field(..., min_length=1)
    target: Optional[str] = None
    note: Optional[str] = None


class ContactOut(BaseModel):
    id: int
    task_id: int
    kind: str
    channel: str
    name: str
    target: Optional[str] = None
    note: Optional[str] = None
    created_at: Optional[str] = None


# ============================================================
# 任务
# ============================================================


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, description="任务标题")
    alias: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[date] = None
    processing_date: Optional[date] = None
    nature: str = TaskNature.TEMPORARY.value
    status: str = TaskStatus.NOT_STARTED.value
    tags: list[str] = Field(default_factory=list)
    contacts: list[ContactIn] = Field(default_factory=list)


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    alias: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[date] = None
    processing_date: Optional[date] = None
    end_date: Optional[date] = None
    nature: Optional[str] = None
    summary: Optional[str] = None
    maintenance_summary: Optional[str] = None
    tags: Optional[list[str]] = None
    contacts: Optional[list[ContactIn]] = None
    # 编辑表单可一并改状态（走状态机校验）
    status: Optional[str] = None


class StatusChange(BaseModel):
    new_status: str = Field(..., description="目标状态")
    end_date: Optional[date] = None
    summary: Optional[str] = None  # 可选：完成时一并写入


class TaskOut(BaseModel):
    id: int
    title: str
    alias: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[str] = None
    processing_date: Optional[str] = None
    end_date: Optional[str] = None
    status: str
    nature: str
    summary: Optional[str] = None
    maintenance_summary: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    original_title: Optional[str] = None
    source: str
    pinned_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    contacts: list[ContactOut] = Field(default_factory=list)


# ============================================================
# 工作日志
# ============================================================


class LogCreate(BaseModel):
    log_date: date
    content: str = Field(..., min_length=1)
    phase: str = LogPhase.MAIN.value


class LogUpdate(BaseModel):
    """编辑日志。三字段全可选；至少传一项（在路由层兜底）。"""

    content: Optional[str] = Field(None, min_length=1)
    log_date: Optional[date] = None
    phase: Optional[str] = None


class LogOut(BaseModel):
    id: int
    task_id: int
    log_date: str
    phase: str
    ordinal: int
    content: str
    polished_content: Optional[str] = None
    is_deleted: bool = False
    deleted_at: Optional[str] = None
    updated_at: Optional[str] = None
    edit_count: int = 0
    created_at: Optional[str] = None


# ============================================================
# 盘点
# ============================================================


class StaleOut(BaseModel):
    id: int
    title: str
    status: str
    nature: str
    last_log_date: Optional[str] = None
    days_idle: Optional[int] = None


class OverviewOut(BaseModel):
    total_tasks: int
    by_status: dict[str, int]
    by_nature: dict[str, int]
    total_logs: int
