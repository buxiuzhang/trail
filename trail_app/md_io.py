"""md ↔ DuckDB 转换逻辑。

解析：parse_md(text) → list[ParsedTask]
灌库：import_to_db(con, parsed, source) → ImportResult
导出：export_to_md(con, output_path, only_open=False) → 写入 md 文件

字段映射见 docs/SCHEMA.md §行为约定。

md 格式（v2 任务对接 + 任务别名）：
    ## {title}
    **任务基本信息**
    | 项目 | 描述 |
    | 任务别名 | {alias} |
    | 任务描述 | ... |
    | 任务开始时间 | YYYY-MM-DD |
    | 任务处理时间 | YYYY-MM-DD |
    | 任务完成时间 | YYYY-MM-DD |
    | 任务完成状态 | 进行中 |
    | 任务性质 | 临时 |
    | 标签 | a, b |

    **任务对接**
    - 群｜钉钉｜动环监控告警AI智能分析
    - 对接人｜微信｜王萌（wxid_abc）/数据湖值班
    - 邮箱｜邮箱｜zhang@example.com

    **任务处理情况**
    | 日期 | 工作情况 |
    | --- | --- |
    | 2026-05-30 | 找到 root cause |
    ...
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Optional

import duckdb

from trail_app.models import (
    ChannelKind,
    ChannelPlatform,
    LogPhase,
    ParsedTask,
    SPELLING_FIXES,
    TaskNature,
    TaskStatus,
)


# ============================================================
# 解析结果汇总
# ============================================================


@dataclass
class ImportResult:
    """灌库结果汇总。"""

    imported: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.imported) + len(self.skipped) + len(self.errors)


# ============================================================
# 文本清洗
# ============================================================


def _strip_html(text: str) -> str:
    """去除 HTML 标签，<br /> 替换为换行。"""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return text


def _clean_cell(text: str) -> str:
    """清理单元格：去 HTML + 还原 \\| 转义 + 合并多空行 + 去首尾空白。"""
    text = _strip_html(text)
    text = text.replace("\\|", "|")
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def _fix_spelling(title: str) -> tuple[str, Optional[str]]:
    """纠正拼写。返回 (纠正后, 原拼写)。原拼写为 None 表示未纠正。"""
    fixed = title
    original = None
    for wrong, right in SPELLING_FIXES.items():
        if wrong in fixed:
            if original is None:
                original = wrong
            fixed = fixed.replace(wrong, right)
    return fixed, original


def _normalize_summary(text: str) -> Optional[str]:
    """"无" / 空白 → None。"""
    text = text.strip()
    if not text or text == "无":
        return None
    return text


def _safe_status(value: Optional[str]) -> str:
    if not value:
        return TaskStatus.IN_PROGRESS.value
    try:
        return TaskStatus(value).value
    except ValueError:
        return TaskStatus.IN_PROGRESS.value


def _safe_nature(value: Optional[str]) -> str:
    if not value:
        return TaskNature.TEMPORARY.value
    try:
        return TaskNature(value).value
    except ValueError:
        return TaskNature.TEMPORARY.value


def _is_valid_date(s: str) -> bool:
    return bool(re.match(r"^\d{4}-\d{2}-\d{2}$", s.strip()))


def parse_tags(raw: Optional[str]) -> list[str]:
    """解析 md 中的标签字符串。

    支持分隔符：`,` / `，` / `、` / 空白。
    """
    if not raw:
        return []
    parts = re.split(r"[,，、\s]+", raw)
    return [p.strip() for p in parts if p.strip()]


def format_tags(tags: list[str]) -> str:
    """导出时把 list 拼回字符串。空列表返回空串。"""
    return ", ".join(tags) if tags else ""


# ============================================================
# 对接渠道解析（"任务对接"段）
# ============================================================


# 渠道中文标签 → 内部值
_KIND_REV = {v: k for k, v in ChannelKind.labels().items()}
_PLATFORM_REV = {v: k for k, v in ChannelPlatform.labels().items()}

# 一行解析：- 群｜钉钉｜动环监控告警AI智能分析
# 兼容 ｜ / | /  全角竖线
_CONTACT_LINE_RE = re.compile(
    r"^\s*-\s*([^|｜\n]+?)\s*[|｜]\s*([^|｜\n]+?)\s*[|｜]\s*(.+?)\s*$"
)


def _parse_contact_line(line: str) -> Optional[dict]:
    """解析「任务对接」单行：`- 群｜钉钉｜名称（target）/note`"""
    m = _CONTACT_LINE_RE.match(line)
    if not m:
        return None
    kind_label = m.group(1).strip()
    channel_label = m.group(2).strip()
    rest = m.group(3).strip()
    if not rest:
        return None

    kind = _KIND_REV.get(kind_label, kind_label)  # 已是英文就原样
    channel = _PLATFORM_REV.get(channel_label, channel_label)

    # 从 rest 抠出 name / (target) / /note
    target: Optional[str] = None
    note: Optional[str] = None
    # 1. 抠括号 target
    paren_m = re.search(r"[（(]([^()）]+)[)）]", rest)
    if paren_m:
        target = paren_m.group(1).strip() or None
        rest = (rest[: paren_m.start()] + rest[paren_m.end():]).strip()
    # 2. 抠斜杠 / 全角斜杠 note
    slash_idx = re.search(r"[/／]", rest)
    if slash_idx:
        note = rest[slash_idx.end():].strip() or None
        rest = rest[: slash_idx.start()].strip()
    # 3. 剩下就是 name（去尾部标点）
    name = rest.strip(" ,，;；。.·").strip()
    if not name:
        return None
    return {
        "kind": kind,
        "channel": channel,
        "name": name,
        "target": target,
        "note": note,
    }


def parse_contacts_block(text: str) -> list[dict]:
    """解析「任务对接」段全部行。"""
    contacts: list[dict] = []
    for line in text.splitlines():
        c = _parse_contact_line(line)
        if c:
            contacts.append(c)
    return contacts


def format_contact_line(c: dict) -> str:
    """导出单行：`- 群｜钉钉｜动环监控告警AI智能分析（群号）/备注`"""
    kind_label = ChannelKind.labels().get(c.get("kind", ""), c.get("kind", ""))
    channel_label = ChannelPlatform.labels().get(c.get("channel", ""), c.get("channel", ""))
    name = c.get("name", "")
    parts = [name]
    if c.get("target"):
        parts.append(f"（{c['target']}）")
    main = "".join(parts)
    if c.get("note"):
        main = f"{main}／{c['note']}"
    return f"- {kind_label}｜{channel_label}｜{main}"


# ============================================================
# 表格解析
# ============================================================


def _parse_table_rows(text: str) -> list[list[str]]:
    """解析 Markdown 表格，返回每行 cells 列表。

    处理 \\| 转义：在 split 前用占位符保护，分割后再还原。
    """
    rows = []
    PLACEHOLDER = "\x00PIPE\x00"
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        if re.match(r"^\|[\s\-:|]+\|$", line):
            continue  # 分隔行
        # 保护 \| → 占位符，避免被切分破坏
        protected = line.replace("\\|", PLACEHOLDER)
        cells = [c.strip() for c in protected.strip("|").split("|")]
        cells = [c.replace(PLACEHOLDER, "|") for c in cells]
        rows.append(cells)
    return rows


def _parse_info_table(text: str) -> dict:
    """解析"任务基本信息"表（两列：field | value）。"""
    info: dict = {}
    for cells in _parse_table_rows(text):
        if len(cells) < 2:
            continue
        info[cells[0]] = _clean_cell(cells[1])
    return {
        "description": info.get("任务描述") or None,
        "alias": info.get("任务别名") or None,
        "start_date": info.get("任务开始时间") or None,
        "processing_date": info.get("任务处理时间") or None,
        "completed_date": info.get("任务完成时间") or None,
        "status": _safe_status(info.get("任务完成状态")),
        "nature": _safe_nature(info.get("任务性质")),
        "tags": parse_tags(info.get("标签")),
    }


def _parse_log_table(text: str) -> list[dict]:
    """解析"任务处理情况"表（两列：日期 | 工作情况）。"""
    logs = []
    for cells in _parse_table_rows(text):
        if len(cells) < 2:
            continue
        log_date = cells[0].strip()
        content = _clean_cell("|".join(cells[1:]))
        if not _is_valid_date(log_date):
            continue
        if not log_date or not content:
            continue
        logs.append({"log_date": log_date, "content": content})
    return logs


def _parse_summary(text: str) -> Optional[str]:
    """解析"任务总结"代码块（``` 包裹）。"""
    match = re.search(r"```\s*\n(.*?)\n```", text, re.DOTALL)
    if not match:
        return None
    return _normalize_summary(match.group(1))


def _split_body(body: str) -> tuple[str, str, str, str]:
    """把 body 按 **任务基本信息** / **任务对接** / **任务处理情况** / **任务总结** 切为 4 段。"""
    info_text = body
    contacts_text = ""
    log_text = ""
    summary_text = ""

    # 顺序：基本信息 → (对接) → 处理情况 → 总结
    # 处理情况必须存在；对接可选；总结可选
    log_match = re.search(r"\*\*任务处理情况\*\*", body)
    if log_match:
        info_text = body[: log_match.start()]
        rest = body[log_match.end():]
        sum_match = re.search(r"\*\*任务总结\*\*", rest)
        if sum_match:
            log_text = rest[: sum_match.start()]
            summary_text = rest[sum_match.end():]
        else:
            log_text = rest
    else:
        sum_match = re.search(r"\*\*任务总结\*\*", body)
        if sum_match:
            info_text = body[: sum_match.start()]
            summary_text = body[sum_match.end():]

    # 从 info_text 里把"任务对接"段切出来
    contacts_match = re.search(r"\*\*任务对接\*\*", info_text)
    if contacts_match:
        contacts_text = info_text[contacts_match.end():]
        info_text = info_text[: contacts_match.start()]

    return info_text, contacts_text, log_text, summary_text


# ============================================================
# 顶层解析
# ============================================================


def parse_md(content: str) -> list[ParsedTask]:
    """解析 md 全文，返回 ParsedTask 列表。"""
    tasks: list[ParsedTask] = []

    sections = re.split(r"(?m)^## (.+)$", content)
    # 结构：[前缀, title1, body1, title2, body2, ...]
    i = 1
    while i < len(sections) - 1:
        raw_title = sections[i].strip()
        body = sections[i + 1]
        i += 2

        # 跳过非任务标题
        if not raw_title or "说明" in raw_title:
            continue
        if raw_title in ("任务完成状态：", "任务性质："):
            continue

        info_text, contacts_text, log_text, summary_text = _split_body(body)

        fixed_title, original = _fix_spelling(raw_title)

        info = _parse_info_table(info_text)
        contacts = parse_contacts_block(contacts_text) if contacts_text else []
        logs = _parse_log_table(log_text)
        summary = _parse_summary(summary_text)

        tasks.append(
            ParsedTask(
                title=fixed_title,
                original_title=original,
                description=info["description"],
                alias=info["alias"],
                start_date=info["start_date"],
                processing_date=info["processing_date"],
                completed_date=info["completed_date"],
                status=info["status"],
                nature=info["nature"],
                summary=summary,
                tags=info["tags"],
                contacts=contacts,
                work_logs=logs,
            )
        )

    return tasks


# ============================================================
# 灌库
# ============================================================


def _task_exists_by_title(
    con: duckdb.DuckDBPyConnection, title: str
) -> bool:
    return bool(
        con.execute("SELECT 1 FROM tasks WHERE title = ?", [title]).fetchone()
    )


def _insert_task(
    con: duckdb.DuckDBPyConnection, p: ParsedTask, source: str
) -> int:
    """插入单个任务，返回自增 id。"""
    cur = con.execute(
        """
        INSERT INTO tasks (
            title, alias, description,
            start_date, processing_date, end_date,
            status, nature, summary, tags, original_title, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        """,
        [
            p.title,
            p.alias,
            p.description,
            p.start_date,
            p.processing_date,
            p.completed_date,
            p.status,
            p.nature,
            p.summary,
            p.tags or [],
            p.original_title,
            source,
        ],
    )
    return int(cur.fetchone()[0])


def _insert_contacts(
    con: duckdb.DuckDBPyConnection, task_id: int, contacts: list[dict]
) -> None:
    """追加对接渠道。"""
    for c in contacts:
        con.execute(
            """
            INSERT INTO contact_channels (task_id, kind, channel, name, target, note)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                task_id,
                c.get("kind"),
                c.get("channel"),
                c.get("name"),
                c.get("target"),
                c.get("note"),
            ],
        )


def _insert_work_logs(
    con: duckdb.DuckDBPyConnection, task_id: int, logs: list[dict]
) -> None:
    """追加工作日志。同日期内按出现顺序写 ordinal。"""
    seen: dict[str, int] = {}
    for log in logs:
        if not log.get("log_date") or not log.get("content"):
            continue
        ordinal = seen.get(log["log_date"], 0)
        seen[log["log_date"]] = ordinal + 1
        con.execute(
            """
            INSERT INTO work_logs (task_id, log_date, phase, ordinal, content)
            VALUES (?, ?, ?, ?, ?)
            """,
            [task_id, log["log_date"], LogPhase.MAIN.value, ordinal, log["content"]],
        )


def import_to_db(
    con: duckdb.DuckDBPyConnection,
    parsed: list[ParsedTask],
    source: str = "任务需求.md",
) -> ImportResult:
    """灌库：已存在按 title 跳过（幂等）。"""
    result = ImportResult()
    for p in parsed:
        try:
            if _task_exists_by_title(con, p.title):
                result.skipped.append(p.title)
                continue
            new_id = _insert_task(con, p, source)
            _insert_contacts(con, new_id, p.contacts)
            _insert_work_logs(con, new_id, p.work_logs)
            result.imported.append(p.title)
        except Exception as e:  # noqa: BLE001
            result.errors.append(f"{p.title}: {e}")
    return result


# ============================================================
# 导出
# ============================================================


# 状态排序：维护中 → 进行中 → 未开始 → 已完成 → 已作废
_STATUS_ORDER = [
    TaskStatus.MAINTENANCE.value,
    TaskStatus.IN_PROGRESS.value,
    TaskStatus.NOT_STARTED.value,
    TaskStatus.COMPLETED.value,
    TaskStatus.CANCELLED.value,
]


def _format_date(d) -> str:
    """DuckDB date → YYYY-MM-DD 字符串。"""
    if d is None:
        return ""
    if isinstance(d, date):
        return d.isoformat()
    return str(d)


def _escape_cell(text: str) -> str:
    """md 表格 cell 转义：| → \\|，换行 → <br />。"""
    if not text:
        return ""
    return text.replace("|", "\\|").replace("\n", "<br />")


def _task_to_md(task: dict, logs: list[dict], contacts: list[dict]) -> str:
    """单个任务转 md 字符串。"""
    lines: list[str] = []
    lines.append(f"## {task['title']}")
    lines.append("")
    lines.append("**任务基本信息**")
    lines.append("")
    lines.append("| 项目         | 描述 |")
    lines.append("| ------------ | --- |")
    if task.get("alias"):
        lines.append(f"| 任务别名     | {_escape_cell(task['alias'])} |")
    lines.append(f"| 任务描述     | {_escape_cell(task.get('description'))} |")
    lines.append(f"| 任务开始时间 | {_format_date(task.get('start_date'))} |")
    lines.append(f"| 任务处理时间 | {_format_date(task.get('processing_date'))} |")
    lines.append(f"| 任务完成时间 | {_format_date(task.get('end_date'))} |")
    lines.append(f"| 任务完成状态 | {task.get('status') or ''} |")
    lines.append(f"| 任务性质     | {task.get('nature') or ''} |")
    lines.append(f"| 标签         | {_escape_cell(format_tags(task.get('tags') or []))} |")
    lines.append("")

    if contacts:
        lines.append("**任务对接**")
        lines.append("")
        for c in contacts:
            lines.append(format_contact_line(c))
        lines.append("")

    lines.append("**任务处理情况**")
    lines.append("")
    if logs:
        lines.append("| 日期 | 工作情况 |")
        lines.append("| --- | --- |")
        for log in logs:
            content = _escape_cell(log.get("content"))
            lines.append(f"| {_format_date(log.get('log_date'))} | {content} |")
    else:
        lines.append("|  |  |")
    lines.append("")
    lines.append("**任务总结**")
    lines.append("")
    summary = task.get("summary") or "无"
    lines.append("```")
    lines.append(summary)
    lines.append("```")
    lines.append("")
    return "\n".join(lines)


def export_to_md(
    con: duckdb.DuckDBPyConnection,
    output_path: Path,
    only_open: bool = False,
) -> int:
    """把 DB 导出为 md 格式。返回写入的任务数。"""
    open_statuses = {
        TaskStatus.MAINTENANCE.value,
        TaskStatus.IN_PROGRESS.value,
        TaskStatus.NOT_STARTED.value,
    }

    rows = con.execute(
        """
        SELECT id, title, alias, description,
               start_date, processing_date, end_date,
               status, nature, summary, tags, original_title, source
        FROM tasks
        ORDER BY
          CASE status
            WHEN '维护中' THEN 0
            WHEN '进行中' THEN 1
            WHEN '未开始' THEN 2
            WHEN '已完成' THEN 3
            WHEN '已作废' THEN 4
            ELSE 5
          END,
          start_date DESC NULLS LAST,
          title
        """
    ).fetchall()
    cols = [d[0] for d in con.description]
    tasks = [dict(zip(cols, r)) for r in rows]

    if only_open:
        tasks = [t for t in tasks if t["status"] in open_statuses]

    # 一次性取所有 contacts
    task_ids = [t["id"] for t in tasks]
    contacts_by_task: dict[int, list[dict]] = {}
    if task_ids:
        placeholders = ",".join("?" for _ in task_ids)
        crows = con.execute(
            f"""
            SELECT task_id, kind, channel, name, target, note
            FROM contact_channels
            WHERE task_id IN ({placeholders})
            ORDER BY task_id, id
            """,
            task_ids,
        ).fetchall()
        for r in crows:
            tid = r[0]
            contacts_by_task.setdefault(tid, []).append(
                {
                    "kind": r[1],
                    "channel": r[2],
                    "name": r[3],
                    "target": r[4],
                    "note": r[5],
                }
            )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("# 个人工作情况说明\n\n")
        f.write("任务完成状态：未开始、进行中、已作废、已完成、维护中\n\n")
        f.write("任务性质：长期、临时、维护\n\n")
        f.write("```\n")
        f.write("任务性质说明：\n")
        f.write("```\n\n")
        for t in tasks:
            logs = con.execute(
                """
                SELECT log_date, content
                FROM work_logs
                WHERE task_id = ? AND phase = 'main'
                ORDER BY log_date, ordinal
                """,
                [t["id"]],
            ).fetchall()
            log_dicts = [
                {"log_date": ld, "content": c} for ld, c in logs
            ]
            contacts = contacts_by_task.get(t["id"], [])
            f.write(_task_to_md(t, log_dicts, contacts))
            f.write("\n")

    return len(tasks)
