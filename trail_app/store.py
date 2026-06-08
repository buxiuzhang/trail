"""数据访问层：TaskStore + WorkLogStore + ContactStore。

封装 DuckDB CRUD，统一：
- 状态机校验（models.is_valid_transition）
- updated_at 维护
- 异常类型（NotFound / InvalidTransition / Duplicate）

Web 层 / 脚本层只跟 store 打交道，不直接接触 duckdb 连接。
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional

import duckdb

from trail_app.db import READONLY, get_connection
from trail_app.models import (
    ChannelKind,
    ChannelPlatform,
    LogPhase,
    TaskNature,
    TaskStatus,
    is_valid_transition,
)


# ============================================================
# 异常
# ============================================================


class StoreError(Exception):
    """store 基类异常。"""


class NotFound(StoreError):
    """任务/日志不存在。"""


class Duplicate(StoreError):
    """任务标题重复（id 已存在）。"""


class InvalidTransition(StoreError):
    """非法状态转移。"""


# ============================================================
# 连接辅助
# ============================================================


def _open(db_path: Optional[str]):
    """DuckDB 连接 ctxmgr（避免重复 boilerplate）。"""
    from contextlib import contextmanager

    @contextmanager
    def _ctx(p):
        if p:
            con = duckdb.connect(str(p), read_only=READONLY)
        else:
            from trail_app.utils import get_db_path as _gdp
            con = duckdb.connect(str(_gdp()), read_only=READONLY)
        try:
            yield con
        finally:
            con.close()

    return _ctx(db_path)


def _row_to_dict_with_dates(zipped) -> dict:
    """通用 row→dict：date / datetime → iso 字符串，tags NULL → []。"""
    d = dict(zipped)
    from datetime import date as _date, datetime as _dt
    for k, v in list(d.items()):
        if isinstance(v, _dt):
            d[k] = v.isoformat(sep=" ")
        elif isinstance(v, _date):
            d[k] = v.isoformat()
    if d.get("tags") is None:
        d["tags"] = []
    if d.get("is_deleted") is None:
        d["is_deleted"] = False
    if d.get("edit_count") is None:
        d["edit_count"] = 0
    return d


# ============================================================
# TaskStore
# ============================================================


class TaskStore:
    """任务 CRUD。"""

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = db_path

    def _connect(self):
        gen = _open(self.db_path)
        return gen.__enter__(), gen

    def _close(self, gen) -> None:
        try:
            gen.__exit__(None, None, None)
        except Exception:
            pass

    # ----- 查询 -----
    def list_tasks(
        self,
        status: Optional[str] = None,
        nature: Optional[str] = None,
        search: Optional[str] = None,
    ) -> list[dict]:
        con, gen = self._connect()
        try:
            # 自动升级：临时任务超过一个月未完成 → 长期
            con.execute(
                "UPDATE tasks SET nature = ?, updated_at = CURRENT_TIMESTAMP"
                " WHERE nature = ? AND status NOT IN (?, ?)"
                " AND start_date IS NOT NULL AND start_date < CURRENT_DATE - 30",
                [TaskNature.LONG_TERM.value, TaskNature.TEMPORARY.value,
                 TaskStatus.COMPLETED.value, TaskStatus.CANCELLED.value],
            )

            sql = "SELECT * FROM tasks WHERE 1=1"
            params: list = []
            if status:
                sql += " AND status = ?"
                params.append(status)
            if nature:
                sql += " AND nature = ?"
                params.append(nature)
            if search:
                sql += " AND title LIKE ?"
                params.append(f"%{search}%")
            sql += (
                " ORDER BY"
                "  pinned_at DESC NULLS LAST,"
                "  CASE status"
                "    WHEN '维护中' THEN 0"
                "    WHEN '进行中' THEN 1"
                "    WHEN '未开始' THEN 2"
                "    WHEN '已完成' THEN 3"
                "    WHEN '已作废' THEN 4"
                "    ELSE 5"
                "  END,"
                "  start_date DESC NULLS LAST,"
                "  title"
            )
            rows = con.execute(sql, params).fetchall()
            cols = [d[0] for d in con.description]
            return [_row_to_dict_with_dates(zip(cols, r)) for r in rows]
        finally:
            self._close(gen)

    def get_task(self, task_id: int) -> dict:
        con, gen = self._connect()
        try:
            row = con.execute("SELECT * FROM tasks WHERE id = ?", [task_id]).fetchone()
            if not row:
                raise NotFound(f"任务不存在：{task_id}")
            cols = [d[0] for d in con.description]
            return _row_to_dict_with_dates(zip(cols, row))
        finally:
            self._close(gen)

    # ----- 创建 -----
    def create_task(
        self,
        title: str,
        nature: str = TaskNature.TEMPORARY.value,
        alias: Optional[str] = None,
        description: Optional[str] = None,
        start_date: Optional[str] = None,
        processing_date: Optional[str] = None,
        status: str = TaskStatus.NOT_STARTED.value,
        tags: Optional[list[str]] = None,
    ) -> dict:
        if not title or not title.strip():
            raise StoreError("标题不能为空")
        if status not in TaskStatus.all():
            raise StoreError(f"非法状态：{status}")
        if nature not in TaskNature.all():
            raise StoreError(f"非法性质：{nature}")

        con, gen = self._connect()
        try:
            # 标题去重（同 md 灌库幂等用）
            if con.execute(
                "SELECT 1 FROM tasks WHERE title = ?", [title.strip()]
            ).fetchone():
                raise Duplicate(f"任务已存在：{title}")
            cur = con.execute(
                """
                INSERT INTO tasks (
                    title, alias, description,
                    start_date, processing_date, status, nature, tags
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING id
                """,
                [
                    title.strip(),
                    (alias or None) and alias.strip() or None,
                    description,
                    start_date,
                    processing_date,
                    status,
                    nature,
                    tags or [],
                ],
            )
            new_id = int(cur.fetchone()[0])
            return self.get_task(new_id)
        finally:
            self._close(gen)

    # ----- 更新 -----
    def update_task(self, task_id: int, **fields) -> dict:
        """更新任务字段（不含 status 转移，转移走 change_status）。

        id 永不变（数据库自增 BIGINT，不依赖标题）。
        """
        allowed = {
            "title", "alias", "description",
            "start_date", "processing_date", "end_date",
            "nature", "summary", "maintenance_summary",
            "tags",
        }
        bad = set(fields) - allowed
        if bad:
            raise StoreError(f"不允许通过 update_task 改字段：{bad}")

        if "title" in fields and (not fields["title"] or not fields["title"].strip()):
            raise StoreError("标题不能为空")
        if "title" in fields:
            fields["title"] = fields["title"].strip()

        if "alias" in fields and fields["alias"]:
            fields["alias"] = fields["alias"].strip() or None

        if "nature" in fields and fields["nature"] not in TaskNature.all():
            raise StoreError(f"非法性质：{fields['nature']}")

        if not fields:
            return self.get_task(task_id)

        sets = ", ".join(f"{k} = ?" for k in fields)
        sets += ", updated_at = CURRENT_TIMESTAMP"
        params = list(fields.values()) + [task_id]
        con, gen = self._connect()
        try:
            cur = con.execute(f"UPDATE tasks SET {sets} WHERE id = ?", params)
            if cur.rowcount == 0:
                raise NotFound(f"任务不存在：{task_id}")
            return self.get_task(task_id)
        finally:
            self._close(gen)

    # ----- 状态转移 -----
    def change_status(
        self,
        task_id: int,
        new_status: str,
        end_date: Optional[str] = None,
    ) -> dict:
        """改状态。校验合法转移。end_date 在进入已完成/维护中时建议传。"""
        if new_status not in TaskStatus.all():
            raise StoreError(f"非法状态：{new_status}")
        task = self.get_task(task_id)
        old = task["status"]
        if old == new_status:
            return task
        if not is_valid_transition(old, new_status):
            raise InvalidTransition(f"非法转移：{old} → {new_status}")

        con, gen = self._connect()
        try:
            updates: dict = {"status": new_status}
            if new_status in (TaskStatus.COMPLETED.value, TaskStatus.MAINTENANCE.value):
                # 主体完成 / 进入维护：end_date 写"完成时间"
                updates["end_date"] = end_date or date.today().isoformat()
            if new_status == TaskStatus.MAINTENANCE.value:
                # 进入维护中 → 性质自动转为"维护"
                updates["nature"] = TaskNature.MAINTENANCE.value
            if new_status == TaskStatus.CANCELLED.value:
                # 作废：清空 end_date
                updates["end_date"] = None
            sets = ", ".join(f"{k} = ?" for k in updates)
            sets += ", updated_at = CURRENT_TIMESTAMP"
            params = list(updates.values()) + [task_id]
            con.execute(f"UPDATE tasks SET {sets} WHERE id = ?", params)
            return self.get_task(task_id)
        finally:
            self._close(gen)

    def cancel_task(self, task_id: int) -> dict:
        return self.change_status(task_id, TaskStatus.CANCELLED.value)

    # ----- 置顶 -----
    def pin(self, task_id: int) -> dict:
        """置顶：写 pinned_at = now()。幂等：已置顶再 pin 不会改时间（保持原顺序）。"""
        con, gen = self._connect()
        try:
            cur = con.execute(
                "UPDATE tasks SET pinned_at = COALESCE(pinned_at, CURRENT_TIMESTAMP) "
                "WHERE id = ? RETURNING id",
                [task_id],
            )
            if cur.fetchone() is None:
                raise NotFound(f"任务不存在：{task_id}")
            return self.get_task(task_id)
        finally:
            self._close(gen)

    def unpin(self, task_id: int) -> dict:
        """取消置顶：pinned_at = NULL。幂等：未置顶再 unpin 不报错。"""
        con, gen = self._connect()
        try:
            cur = con.execute(
                "UPDATE tasks SET pinned_at = NULL WHERE id = ? RETURNING id",
                [task_id],
            )
            if cur.fetchone() is None:
                raise NotFound(f"任务不存在：{task_id}")
            return self.get_task(task_id)
        finally:
            self._close(gen)

    def delete_task(self, task_id: int) -> None:
        """硬删任务。手动级联删 contact_channels / work_logs / ai_records
        （DuckDB FK 不支持 CASCADE）。按子表 → 主表顺序删。"""
        con, gen = self._connect()
        try:
            if not con.execute(
                "SELECT 1 FROM tasks WHERE id = ?", [task_id]
            ).fetchone():
                raise NotFound(f"任务不存在：{task_id}")
            con.execute("DELETE FROM contact_channels WHERE task_id = ?", [task_id])
            con.execute("DELETE FROM work_logs WHERE task_id = ?", [task_id])
            con.execute("DELETE FROM ai_records WHERE task_id = ?", [task_id])
            cur = con.execute("DELETE FROM tasks WHERE id = ?", [task_id])
            if cur.rowcount == 0:
                raise NotFound(f"任务不存在：{task_id}")
        finally:
            self._close(gen)


# ============================================================
# WorkLogStore
# ============================================================


class WorkLogStore:
    """工作日志追加。"""

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = db_path

    def _connect(self):
        gen = _open(self.db_path)
        return gen.__enter__(), gen

    def _close(self, gen) -> None:
        try:
            gen.__exit__(None, None, None)
        except Exception:
            pass

    def list_logs(
        self,
        task_id: int,
        phase: Optional[str] = None,
        include_deleted: bool = False,
        since_days: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> list[dict]:
        """取任务的工作日志。

        新增参数（tool use 引入）：
        - since_days: 只取最近 N 天的（基于 log_date 字符串字典序比较，
          'YYYY-MM-DD' 格式下字符串序与日期序一致）
        - limit: 最多返多少条；为 None 时不限
        """
        con, gen = self._connect()
        try:
            where = ["task_id = ?"]
            params: list = [task_id]
            if phase:
                where.append("phase = ?")
                params.append(phase)
            if not include_deleted:
                where.append("is_deleted = FALSE")
            if since_days is not None:
                from datetime import date, timedelta
                cutoff = (date.today() - timedelta(days=since_days)).isoformat()
                where.append("log_date >= ?")
                params.append(cutoff)
            sql = f"SELECT * FROM work_logs WHERE {' AND '.join(where)} ORDER BY log_date, ordinal"
            if limit is not None:
                sql += " LIMIT ?"
                params.append(limit)
            rows = con.execute(sql, params).fetchall()
            cols = [d[0] for d in con.description]
            return [_row_to_dict_with_dates(zip(cols, r)) for r in rows]
        finally:
            self._close(gen)

    def latest_log_date(self, task_id: int) -> Optional[str]:
        """返回任务最近一条未软删日志的 log_date（'YYYY-MM-DD'），无则 None。

        用于「活跃判定」等只需要日期的轻量查询，比 list_logs 省内存。
        """
        con, gen = self._connect()
        try:
            row = con.execute(
                """
                SELECT MAX(log_date)
                FROM work_logs
                WHERE task_id = ? AND is_deleted = FALSE
                """,
                [task_id],
            ).fetchone()
            return row[0] if row and row[0] else None
        finally:
            self._close(gen)

    def add_log(
        self,
        task_id: int,
        log_date: str,
        content: str,
        phase: str = LogPhase.MAIN.value,
    ) -> dict:
        if not content or not content.strip():
            raise StoreError("日志内容不能为空")
        if phase not in {LogPhase.MAIN.value, LogPhase.MAINTENANCE.value}:
            raise StoreError(f"非法 phase：{phase}")

        con, gen = self._connect()
        try:
            # 校验任务存在 + 已完成/已作废不可再写日志
            row = con.execute(
                "SELECT status FROM tasks WHERE id = ?", [task_id]
            ).fetchone()
            if not row:
                raise NotFound(f"任务不存在：{task_id}")
            if row[0] in (TaskStatus.COMPLETED.value, TaskStatus.CANCELLED.value):
                raise StoreError("已完成/已作废的任务不能添加日志")
            # 同 phase 同日期内 ordinal 自增
            row = con.execute(
                """
                SELECT COALESCE(MAX(ordinal), -1) + 1
                FROM work_logs
                WHERE task_id = ? AND phase = ? AND log_date = ?
                """,
                [task_id, phase, log_date],
            ).fetchone()
            ordinal = int(row[0]) if row else 0
            cur = con.execute(
                """
                INSERT INTO work_logs
                  (task_id, log_date, phase, ordinal, content, is_deleted, edit_count)
                VALUES (?, ?, ?, ?, ?, FALSE, 0)
                RETURNING id
                """,
                [task_id, log_date, phase, ordinal, content.strip()],
            )
            log_id = cur.fetchone()[0]
            row = con.execute(
                "SELECT * FROM work_logs WHERE id = ?", [log_id]
            ).fetchone()
            cols = [d[0] for d in con.description]
            return _row_to_dict_with_dates(zip(cols, row))
        finally:
            self._close(gen)

    # ----- 编辑 / 软删 -----
    def _get_log(self, log_id: int) -> dict:
        """单条回读；不存在抛 NotFound。"""
        con, gen = self._connect()
        try:
            row = con.execute("SELECT * FROM work_logs WHERE id = ?", [log_id]).fetchone()
            if not row:
                raise NotFound(f"日志不存在：{log_id}")
            cols = [d[0] for d in con.description]
            return _row_to_dict_with_dates(zip(cols, row))
        finally:
            self._close(gen)

    def update_log(
        self,
        log_id: int,
        task_id: int,
        content: Optional[str] = None,
        log_date: Optional[str] = None,
        phase: Optional[str] = None,
    ) -> dict:
        """编辑日志。content / log_date / phase 三者全可选；至少传一项。

        (log_date, phase) 变化时，把 ordinal 重排到新 group 的最末；
        旧 group 的后续 ordinal 不动（保持稳定）。edit_count += 1，updated_at = now。
        """
        if content is None and log_date is None and phase is None:
            raise StoreError("至少要改一个字段")
        if content is not None and not content.strip():
            raise StoreError("日志内容不能为空")
        if phase is not None and phase not in {
            LogPhase.MAIN.value,
            LogPhase.MAINTENANCE.value,
        }:
            raise StoreError(f"非法 phase：{phase}")

        con, gen = self._connect()
        try:
            row = con.execute(
                "SELECT log_date, phase, ordinal FROM work_logs WHERE id = ? AND task_id = ? AND is_deleted = FALSE",
                [log_id, task_id],
            ).fetchone()
            if not row:
                raise NotFound(f"日志不存在或不属于此任务：log={log_id} task={task_id}")
            old_date, old_phase, old_ordinal = row
            new_date = log_date or (old_date.isoformat() if hasattr(old_date, "isoformat") else str(old_date))
            new_phase = phase or old_phase

            new_ordinal = old_ordinal
            if new_date != (old_date.isoformat() if hasattr(old_date, "isoformat") else str(old_date)) or new_phase != old_phase:
                r = con.execute(
                    "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM work_logs "
                    "WHERE task_id = ? AND phase = ? AND log_date = ? AND id != ? AND is_deleted = FALSE",
                    [task_id, new_phase, new_date, log_id],
                ).fetchone()
                new_ordinal = int(r[0])

            sets = ["updated_at = CURRENT_TIMESTAMP", "edit_count = edit_count + 1"]
            params: list = []
            if content is not None:
                sets.append("content = ?")
                params.append(content.strip())
            if log_date is not None:
                sets.append("log_date = ?")
                params.append(new_date)
            if phase is not None:
                sets.append("phase = ?")
                params.append(new_phase)
            if new_ordinal != old_ordinal:
                sets.append("ordinal = ?")
                params.append(new_ordinal)
            params.append(log_id)
            con.execute(
                f"UPDATE work_logs SET {', '.join(sets)} WHERE id = ?",
                params,
            )
            return self._get_log(log_id)
        finally:
            self._close(gen)

    def delete_log(self, log_id: int, task_id: int, hard: bool = False) -> None:
        """软删（默认）/ 硬删日志。校验 log 属于 task。

        软删：is_deleted=TRUE, deleted_at=now；list_logs 默认不返回。
        硬删：物理删除行（极少用，留口子）。

        DuckDB 的 cursor.rowcount 在 UPDATE/DELETE 上恒为 -1，
        所以用 RETURNING 拿真实受影响行数。
        """
        con, gen = self._connect()
        try:
            if hard:
                rows = con.execute(
                    "DELETE FROM work_logs WHERE id = ? AND task_id = ? RETURNING id",
                    [log_id, task_id],
                ).fetchall()
            else:
                rows = con.execute(
                    "UPDATE work_logs SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP "
                    "WHERE id = ? AND task_id = ? AND is_deleted = FALSE "
                    "RETURNING id",
                    [log_id, task_id],
                ).fetchall()
            if not rows:
                raise NotFound(f"日志不存在或不属于此任务：log={log_id} task={task_id}")
        finally:
            self._close(gen)


@dataclass
class ContactStore:
    """对接渠道子表 CRUD。"""

    db_path: Optional[str] = None

    def _connect(self):
        gen = _open(self.db_path)
        return gen.__enter__(), gen

    def _close(self, gen) -> None:
        try:
            gen.__exit__(None, None, None)
        except Exception:
            pass

    def list_contacts(self, task_id: int) -> list[dict]:
        con, gen = self._connect()
        try:
            rows = con.execute(
                """
                SELECT id, task_id, kind, channel, name, target, note, created_at
                FROM contact_channels
                WHERE task_id = ?
                ORDER BY id
                """,
                [task_id],
            ).fetchall()
            cols = [d[0] for d in con.description]
            return [_row_to_dict_with_dates(zip(cols, r)) for r in rows]
        finally:
            self._close(gen)

    def list_contacts_bulk(self, task_ids: list[int]) -> dict[int, list[dict]]:
        """批量取多任务的 contacts，返回 {task_id: [contact, ...]}。

        列表页用 N+1 一次 SQL 解决。
        """
        if not task_ids:
            return {}
        con, gen = self._connect()
        try:
            placeholders = ",".join("?" for _ in task_ids)
            rows = con.execute(
                f"""
                SELECT id, task_id, kind, channel, name, target, note, created_at
                FROM contact_channels
                WHERE task_id IN ({placeholders})
                ORDER BY task_id, id
                """,
                task_ids,
            ).fetchall()
            cols = [d[0] for d in con.description]
            grouped: dict[int, list[dict]] = {tid: [] for tid in task_ids}
            for r in rows:
                d = _row_to_dict_with_dates(zip(cols, r))
                grouped[d["task_id"]].append(d)
            return grouped
        finally:
            self._close(gen)

    def set_contacts(self, task_id: int, contacts: list[dict]) -> list[dict]:
        """整组替换：先 DELETE 旧行，再 INSERT 新行（事务）。

        contacts 元素 = {kind, channel, name, target?, note?}
        """
        # 校验
        for c in contacts:
            kind = c.get("kind")
            channel = c.get("channel")
            name = (c.get("name") or "").strip()
            if kind not in ChannelKind.all():
                raise StoreError(f"非法 kind：{kind}")
            if channel not in ChannelPlatform.all():
                raise StoreError(f"非法 channel：{channel}")
            if not name:
                raise StoreError("name 不能为空")
            c["name"] = name
            c.setdefault("target", None)
            c.setdefault("note", None)

        con, gen = self._connect()
        try:
            con.execute("BEGIN")
            try:
                # 校验任务存在
                if not con.execute(
                    "SELECT 1 FROM tasks WHERE id = ?", [task_id]
                ).fetchone():
                    raise NotFound(f"任务不存在：{task_id}")
                con.execute("DELETE FROM contact_channels WHERE task_id = ?", [task_id])
                for c in contacts:
                    con.execute(
                        """
                        INSERT INTO contact_channels (task_id, kind, channel, name, target, note)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        [
                            task_id,
                            c["kind"],
                            c["channel"],
                            c["name"],
                            c.get("target"),
                            c.get("note"),
                        ],
                    )
                con.execute("COMMIT")
            except Exception:
                con.execute("ROLLBACK")
                raise
            return self.list_contacts(task_id)
        finally:
            self._close(gen)


# ============================================================
# AiRecordStore（大模型操作审计）
# ============================================================


class AiRecordStore:
    """ai_records append-only 写入。"""

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = db_path

    def _connect(self):
        gen = _open(self.db_path)
        return gen.__enter__(), gen

    def _close(self, gen) -> None:
        try:
            gen.__exit__(None, None, None)
        except Exception:
            pass

    def add_record(
        self,
        task_id: int,
        op: str,
        prompt: str,
        response: str,
        log_id: Optional[int] = None,
        user_confirmed: bool = False,
    ) -> int:
        """写入一条审计记录，返回新 id。"""
        if op not in {"polish", "summarize", "ask_maintenance", "chat", "chat_tool_use"}:
            raise StoreError(f"非法 op：{op}")
        con, gen = self._connect()
        try:
            cur = con.execute(
                """
                INSERT INTO ai_records (task_id, log_id, op, prompt, response, user_confirmed)
                VALUES (?, ?, ?, ?, ?, ?)
                RETURNING id
                """,
                [task_id, log_id, op, prompt, response, user_confirmed],
            )
            return int(cur.fetchone()[0])
        finally:
            self._close(gen)

    def confirm_record(self, record_id: int) -> None:
        """用户采纳某条 LLM 建议时回写。"""
        con, gen = self._connect()
        try:
            con.execute(
                "UPDATE ai_records SET user_confirmed = TRUE WHERE id = ?",
                [record_id],
            )
        finally:
            self._close(gen)


# ============================================================
# 盘点 / 总览
# ============================================================


class InsightStore:
    """过期任务、总览统计。"""

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = db_path

    def _connect(self):
        gen = _open(self.db_path)
        return gen.__enter__(), gen

    def _close(self, gen) -> None:
        try:
            gen.__exit__(None, None, None)
        except Exception:
            pass

    def stale_tasks(self, idle_days: int = 30) -> list[dict]:
        con, gen = self._connect()
        try:
            rows = con.execute(
                """
                SELECT * FROM v_stale_tasks
                WHERE days_idle IS NULL OR days_idle >= ?
                ORDER BY days_idle DESC NULLS FIRST
                """,
                [idle_days],
            ).fetchall()
            cols = [d[0] for d in con.description]
            result = []
            for r in rows:
                d = dict(zip(cols, r))
                if hasattr(d.get("last_log_date"), "isoformat"):
                    d["last_log_date"] = d["last_log_date"].isoformat()
                result.append(d)
            return result
        finally:
            self._close(gen)

    def overview(self) -> dict:
        con, gen = self._connect()
        try:
            by_status = dict(
                con.execute(
                    "SELECT status, COUNT(*) FROM tasks GROUP BY status"
                ).fetchall()
            )
            by_nature = dict(
                con.execute(
                    "SELECT nature, COUNT(*) FROM tasks GROUP BY nature"
                ).fetchall()
            )
            total_logs = con.execute(
                "SELECT COUNT(*) FROM work_logs"
            ).fetchone()[0]
            return {
                "total_tasks": sum(by_status.values()) if by_status else 0,
                "by_status": by_status,
                "by_nature": by_nature,
                "total_logs": total_logs,
            }
        finally:
            self._close(gen)


# ============================================================
# LLM 设置（加密存储）
# ============================================================

class LLMSettingsStore:
    """LLM 配置的加密读写。所有值加密后存 DuckDB。"""

    def __init__(self, db_path: str | None = None):
        from trail_app.utils import get_db_path
        self._db_path = db_path or str(get_db_path())

    def _connect(self):
        import duckdb
        return duckdb.connect(self._db_path)

    def _close(self, con):
        try:
            con.close()
        except Exception:
            pass

    def get_all(self) -> dict[str, str]:
        """返回所有已保存的明文设置。"""
        from trail_app.crypto import decrypt
        con = self._connect()
        try:
            rows = con.execute("SELECT key, value FROM llm_settings").fetchall()
            return {row[0]: decrypt(row[1]) for row in rows}
        finally:
            self._close(con)

    def save(self, settings: dict[str, str]) -> None:
        """保存设置（加密后 upsert）。"""
        from trail_app.crypto import encrypt
        con = self._connect()
        try:
            for key, value in settings.items():
                token = encrypt(value)
                con.execute(
                    "INSERT OR REPLACE INTO llm_settings (key, value) VALUES (?, ?)",
                    [key, token],
                )
        finally:
            self._close(con)

    def delete(self, key: str) -> None:
        """删除某项设置。"""
        con = self._connect()
        try:
            con.execute("DELETE FROM llm_settings WHERE key = ?", [key])
        finally:
            self._close(con)
