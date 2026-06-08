"""数据模型：枚举 + dataclass。

状态机：
    未开始 / 进行中 / 已作废 / 已完成
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ============================================================
# 枚举
# ============================================================


class TaskStatus(str, Enum):
    """任务状态。"""

    NOT_STARTED = "未开始"
    IN_PROGRESS = "进行中"
    COMPLETED = "已完成"
    CANCELLED = "已作废"

    @classmethod
    def all(cls) -> list[str]:
        return [s.value for s in cls]


class TaskNature(str, Enum):
    """任务性质。"""

    LONG_TERM = "长期"
    TEMPORARY = "临时"
    MAINTENANCE = "维护"

    @classmethod
    def all(cls) -> list[str]:
        return [n.value for n in cls]


class LogPhase(str, Enum):
    """工作日志的 phase。"""

    MAIN = "main"
    MAINTENANCE = "maintenance"


class ChannelKind(str, Enum):
    """对接渠道的本质类型。"""

    GROUP = "group"           # 群
    PERSON = "person"         # 对接人
    EMAIL = "email"           # 邮箱
    PHONE = "phone"           # 电话
    OTHER = "other"           # 其他

    @classmethod
    def all(cls) -> list[str]:
        return [k.value for k in cls]

    @classmethod
    def labels(cls) -> dict[str, str]:
        """kind 值 → 中文标签。"""
        return {
            "group": "群",
            "person": "对接人",
            "email": "邮箱",
            "phone": "电话",
            "other": "其他",
        }


class ChannelPlatform(str, Enum):
    """对接渠道的具体平台。"""

    DINGTALK = "dingtalk"
    WECHAT = "wechat"
    ELINK = "elink"
    LARK = "lark"
    FEISHU = "feishu"
    EMAIL = "email"
    PHONE = "phone"
    OTHER = "other"

    @classmethod
    def all(cls) -> list[str]:
        return [p.value for p in cls]

    @classmethod
    def labels(cls) -> dict[str, str]:
        """platform 值 → 中文标签。"""
        return {
            "dingtalk": "钉钉",
            "wechat": "微信",
            "elink": "elink",
            "lark": "lark",
            "feishu": "飞书",
            "email": "邮箱",
            "phone": "电话",
            "other": "其他",
        }


# ============================================================
# 合法状态转移
# ============================================================

# from → set of allowed to
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    TaskStatus.NOT_STARTED.value: {TaskStatus.IN_PROGRESS.value, TaskStatus.CANCELLED.value},
    TaskStatus.IN_PROGRESS.value: {
        TaskStatus.COMPLETED.value,
        TaskStatus.CANCELLED.value,
    },
    TaskStatus.COMPLETED.value: {
        TaskStatus.IN_PROGRESS.value,
        TaskStatus.CANCELLED.value,
    },
    TaskStatus.CANCELLED.value: set(),  # 终态
}


def is_valid_transition(from_status: str, to_status: str) -> bool:
    """校验状态转移是否合法。"""
    if from_status == to_status:
        return True
    return to_status in ALLOWED_TRANSITIONS.get(from_status, set())


# ============================================================
# 数据类
# ============================================================


@dataclass
class Task:
    """任务。"""

    id: Optional[int] = None  # DB 自增，新建前为 None
    title: str = ""
    status: str = TaskStatus.NOT_STARTED.value
    nature: str = TaskNature.TEMPORARY.value
    alias: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[str] = None
    processing_date: Optional[str] = None
    end_date: Optional[str] = None
    summary: Optional[str] = None
    maintenance_summary: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    original_title: Optional[str] = None
    source: str = "任务需求.md"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@dataclass
class WorkLog:
    """工作日志。"""

    id: Optional[int]
    task_id: int
    log_date: str
    content: str
    phase: str = LogPhase.MAIN.value
    ordinal: int = 0
    polished_content: Optional[str] = None
    is_deleted: bool = False
    deleted_at: Optional[str] = None
    updated_at: Optional[str] = None
    edit_count: int = 0
    created_at: Optional[str] = None


@dataclass
class ContactChannel:
    """对接渠道（一行）。"""

    id: Optional[int] = None
    task_id: Optional[int] = None  # 新建前为 None
    kind: str = ChannelKind.PERSON.value
    channel: str = ChannelPlatform.WECHAT.value
    name: str = ""
    target: Optional[str] = None
    note: Optional[str] = None
    created_at: Optional[str] = None


@dataclass
class ParsedTask:
    """md 解析中间态（灌库前用）。"""

    title: str
    description: Optional[str] = None
    alias: Optional[str] = None
    start_date: Optional[str] = None
    processing_date: Optional[str] = None
    completed_date: Optional[str] = None
    status: str = TaskStatus.NOT_STARTED.value
    nature: str = TaskNature.TEMPORARY.value
    summary: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    contacts: list[dict] = field(default_factory=list)
    work_logs: list[dict] = field(default_factory=list)
    original_title: Optional[str] = None


# ============================================================
# 拼写纠正词典（md → DB 时使用）
# ============================================================

SPELLING_FIXES: dict[str, str] = {
    "TDengien": "TDengine",
    "Reids": "Redis",
}
