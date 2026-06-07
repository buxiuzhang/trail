"""md ↔ DB 转换测试。"""
from __future__ import annotations

from pathlib import Path

import pytest

from trail_app.db import ensure_schema
from trail_app.md_io import (
    _is_valid_date,
    export_to_md,
    format_contact_line,
    import_to_db,
    parse_contacts_block,
    parse_md,
    parse_tags,
)
from trail_app.models import LogPhase, TaskStatus


# ============================================================
# parse_md
# ============================================================


SAMPLE_MD = """# 个人工作情况说明

任务完成状态：未开始、进行中、已作废、已完成

任务性质：长期、临时、维护

```
任务性质说明：
```

## TDengine 时序数据库整库告警监控

**任务基本信息**

| 项目         | 描述                                                         |
| ------------ | ------------------------------------------------------------ |
| 任务描述     | 编写钉钉程序，按系统和厂站进行划分实现超级表数据断流监控     |
| 任务别名     | TDengine告警                                                  |
| 任务开始时间 | 2026-06-02                                                   |
| 任务处理时间 | 2026-06-03                                                   |
| 任务完成时间 |                                                             |
| 任务完成状态 | 进行中                                                       |
| 任务性质     | 长期                                                         |
| 标签         | 监控, 钉钉, 时序                                             |

**任务对接**

- 群｜钉钉｜动环监控告警AI智能分析
- 对接人｜微信｜王萌（wxid_abc）/数据湖值班

**任务处理情况**

| 日期       | 工作情况                                       |
| ---------- | ---------------------------------------------- |
| 2026-06-03 | 1. 编写TDengine 数据库和超表的统计              |

**任务总结**

```
无
```

## 漏洞修复

**任务基本信息**

| 项目         | 描述                                            |
| ------------ | ----------------------------------------------- |
| 任务描述     | 修复Redis Lua脚本远程代码执行漏洞               |
| 任务开始时间 | 2026-06-04                                      |
| 任务处理时间 | 2026-06-05                                      |
| 任务完成时间 | 2026-06-06                                      |
| 任务完成状态 | 已完成                                          |
| 任务性质     | 临时                                            |
| 标签         | 安全、Redis、升级                                |

**任务对接**

- 对接人｜钉钉｜信通网安值班

**任务处理情况**

| 日期       | 工作情况                                                       |
| ---------- | -------------------------------------------------------------- |
| 2026-06-04 | 1. 了解漏洞处理情况                                            |
| 2026-06-05 | 1. 升级Redis到8.2.6<br />2. 准备卸载Doris redis集群            |

**任务总结**

```
升级完毕，Doris 集群下周一卸载
```
"""


def test_parse_md_basic_count():
    tasks = parse_md(SAMPLE_MD)
    assert len(tasks) == 2


def test_parse_md_first_task_fields():
    tasks = parse_md(SAMPLE_MD)
    t1 = tasks[0]
    assert "TDengine" in t1.title
    assert t1.description is not None
    assert "钉钉" in t1.description
    assert t1.alias == "TDengine告警"
    assert t1.start_date == "2026-06-02"
    assert t1.processing_date == "2026-06-03"
    assert t1.completed_date is None
    assert t1.status == TaskStatus.IN_PROGRESS.value
    assert t1.nature == "长期"
    assert t1.summary is None  # "无" → None
    assert len(t1.work_logs) == 1
    assert t1.work_logs[0]["log_date"] == "2026-06-03"


def test_parse_md_completed_task():
    tasks = parse_md(SAMPLE_MD)
    t2 = tasks[1]
    assert t2.status == "已完成"
    assert t2.completed_date == "2026-06-06"
    assert t2.summary == "升级完毕，Doris 集群下周一卸载"
    assert len(t2.work_logs) == 2


def test_parse_md_html_br_in_log():
    tasks = parse_md(SAMPLE_MD)
    t2 = tasks[1]
    log2 = t2.work_logs[1]
    # <br /> 应被替换为换行
    assert "\n" in log2["content"]


def test_parse_md_spelling_fix():
    md = """## TDengien 监控

**任务基本信息**

| 项目 | 描述 |
| --- | --- |
| 任务描述 | test |
| 任务性质 | 长期 |
| 任务完成状态 | 进行中 |

**任务处理情况**

|  |  |
| --- | --- |

**任务总结**

```
无
```
"""
    tasks = parse_md(md)
    assert tasks[0].title == "TDengine 监控"
    assert tasks[0].original_title == "TDengien"


def test_parse_md_skip_header_garbage():
    tasks = parse_md(SAMPLE_MD)
    # 标题里的"个人工作情况说明"和"任务完成状态：" "任务性质："都不应被解析为任务
    titles = [t.title for t in tasks]
    assert all("说明" not in t for t in titles)
    assert all("：" not in t for t in titles)


# ============================================================
# 任务别名 (alias)
# ============================================================


def test_parse_md_with_alias():
    tasks = parse_md(SAMPLE_MD)
    assert tasks[0].alias == "TDengine告警"
    assert tasks[1].alias is None  # 无别名行


# ============================================================
# 对接渠道
# ============================================================


def test_parse_contacts_block_multi_line():
    block = """**任务对接**

- 群｜钉钉｜动环监控告警AI智能分析
- 对接人｜微信｜王萌（wxid_abc）/数据湖值班
- 邮箱｜邮箱｜zhang@example.com
"""
    contacts = parse_contacts_block(block)
    assert len(contacts) == 3
    c1 = contacts[0]
    assert c1["kind"] == "group"
    assert c1["channel"] == "dingtalk"
    assert c1["name"] == "动环监控告警AI智能分析"
    assert c1["target"] is None
    assert c1["note"] is None

    c2 = contacts[1]
    assert c2["kind"] == "person"
    assert c2["channel"] == "wechat"
    assert c2["name"] == "王萌"
    assert c2["target"] == "wxid_abc"
    assert c2["note"] == "数据湖值班"

    c3 = contacts[2]
    assert c3["kind"] == "email"
    assert c3["channel"] == "email"
    assert c3["name"] == "zhang@example.com"


def test_parse_contacts_block_accepts_pipe_and_fullwidth():
    """同时支持半角 | 和全角 ｜。"""
    block = """**任务对接**

- 群|钉钉|测试群
- 群｜微信｜测试群2
"""
    contacts = parse_contacts_block(block)
    assert len(contacts) == 2
    assert contacts[0]["channel"] == "dingtalk"
    assert contacts[1]["channel"] == "wechat"


def test_parse_contacts_block_empty():
    assert parse_contacts_block("") == []
    assert parse_contacts_block("**任务对接**\n") == []


def test_format_contact_line_roundtrip():
    """format 出来的行能再 parse 回同样的字段。"""
    c = {"kind": "person", "channel": "wechat", "name": "王萌", "target": "wxid_abc", "note": "数据湖值班"}
    line = format_contact_line(c)
    parsed = parse_contacts_block(line)
    assert len(parsed) == 1
    assert parsed[0]["name"] == "王萌"
    assert parsed[0]["target"] == "wxid_abc"
    assert parsed[0]["note"] == "数据湖值班"


def test_parse_md_with_contacts():
    tasks = parse_md(SAMPLE_MD)
    t1 = tasks[0]
    assert len(t1.contacts) == 2
    assert t1.contacts[0]["kind"] == "group"
    assert t1.contacts[0]["channel"] == "dingtalk"
    assert t1.contacts[1]["kind"] == "person"
    assert t1.contacts[1]["channel"] == "wechat"

    t2 = tasks[1]
    assert len(t2.contacts) == 1
    assert t2.contacts[0]["name"] == "信通网安值班"


# ============================================================
# import_to_db
# ============================================================


def test_import_to_db(con):
    tasks = parse_md(SAMPLE_MD)
    result = import_to_db(con, tasks, source="test.md")
    assert len(result.imported) == 2
    assert len(result.errors) == 0
    n = con.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    assert n == 2
    n_log = con.execute("SELECT COUNT(*) FROM work_logs").fetchone()[0]
    assert n_log == 3  # 1 + 2
    n_c = con.execute("SELECT COUNT(*) FROM contact_channels").fetchone()[0]
    assert n_c == 3  # 2 + 1


def test_import_to_db_idempotent(con):
    tasks = parse_md(SAMPLE_MD)
    import_to_db(con, tasks)
    # 第二次灌：全部跳过
    result = import_to_db(con, tasks)
    assert len(result.imported) == 0
    assert len(result.skipped) == 2
    n = con.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    assert n == 2


def test_import_to_db_phase_main(con):
    tasks = parse_md(SAMPLE_MD)
    import_to_db(con, tasks)
    phases = {r[0] for r in con.execute("SELECT DISTINCT phase FROM work_logs").fetchall()}
    assert phases == {LogPhase.MAIN.value}


def test_import_preserves_special_chars(con):
    md = """## 测试任务

**任务基本信息**

| 项目 | 描述 |
| --- | --- |
| 任务描述 | 这是一段 \| 含管道符的描述 |
| 任务性质 | 临时 |
| 任务完成状态 | 进行中 |

**任务处理情况**

|  |  |
| --- | --- |

**任务总结**

```
无
```
"""
    tasks = parse_md(md)
    import_to_db(con, tasks)
    row = con.execute(
        "SELECT description FROM tasks WHERE title = ?", ["测试任务"]
    ).fetchone()
    assert row is not None
    assert "管道符" in row[0]


# ============================================================
# export_to_md
# ============================================================


def test_export_roundtrip(con, tmp_path: Path):
    """灌库 → 导出 → 重新解析，任务数与日志数应一致。"""
    tasks = parse_md(SAMPLE_MD)
    import_to_db(con, tasks)

    out = tmp_path / "out.md"
    n = export_to_md(con, out, only_open=False)
    assert n == 2

    re_parsed = parse_md(out.read_text(encoding="utf-8"))
    assert len(re_parsed) == 2
    titles = {t.title for t in re_parsed}
    assert "TDengine 时序数据库整库告警监控" in titles


def test_export_roundtrip_preserves_contacts(con, tmp_path: Path):
    tasks = parse_md(SAMPLE_MD)
    import_to_db(con, tasks)
    out = tmp_path / "out.md"
    export_to_md(con, out)
    re_parsed = parse_md(out.read_text(encoding="utf-8"))
    by_title = {t.title: t.contacts for t in re_parsed}
    assert len(by_title["TDengine 时序数据库整库告警监控"]) == 2
    assert by_title["TDengine 时序数据库整库告警监控"][1]["name"] == "王萌"
    assert len(by_title["漏洞修复"]) == 1
    assert by_title["漏洞修复"][0]["name"] == "信通网安值班"


def test_export_only_open(con, tmp_path: Path):
    tasks = parse_md(SAMPLE_MD)
    import_to_db(con, tasks)
    out = tmp_path / "open.md"
    n = export_to_md(con, out, only_open=True)
    # 第一个进行中，第二个已完成 → only_open 留 1
    assert n == 1


def test_export_creates_parent_dir(con, tmp_path: Path):
    tasks = parse_md(SAMPLE_MD)
    import_to_db(con, tasks)
    out = tmp_path / "subdir" / "out.md"
    n = export_to_md(con, out)
    assert n == 2
    assert out.exists()


# ============================================================
# 工具函数
# ============================================================


@pytest.mark.parametrize(
    "s,expected",
    [
        ("2026-06-07", True),
        ("2026-1-1", False),
        ("", False),
        ("abc", False),
    ],
)
def test_is_valid_date(s, expected):
    assert _is_valid_date(s) is expected


# ============================================================
# 标签 (tags)
# ============================================================


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("监控, 钉钉, 时序", ["监控", "钉钉", "时序"]),
        ("安全、Redis、升级", ["安全", "Redis", "升级"]),
        ("监控,钉钉", ["监控", "钉钉"]),
        ("监控 ， 钉钉", ["监控", "钉钉"]),
        ("  监控  ,  钉钉  ", ["监控", "钉钉"]),
        ("", []),
        (None, []),
        ("监控", ["监控"]),
    ],
)
def test_parse_tags(raw, expected):
    assert parse_tags(raw) == expected


def test_parse_md_with_tags():
    tasks = parse_md(SAMPLE_MD)
    assert tasks[0].tags == ["监控", "钉钉", "时序"]
    assert tasks[1].tags == ["安全", "Redis", "升级"]


def test_import_to_db_with_tags(con):
    tasks = parse_md(SAMPLE_MD)
    import_to_db(con, tasks)
    rows = con.execute(
        "SELECT title, tags FROM tasks ORDER BY title"
    ).fetchall()
    by_title = {r[0]: list(r[1] or []) for r in rows}
    assert by_title["TDengine 时序数据库整库告警监控"] == ["监控", "钉钉", "时序"]
    assert by_title["漏洞修复"] == ["安全", "Redis", "升级"]


def test_export_roundtrip_preserves_tags(con, tmp_path: Path):
    tasks = parse_md(SAMPLE_MD)
    import_to_db(con, tasks)
    out = tmp_path / "out.md"
    export_to_md(con, out)
    re_parsed = parse_md(out.read_text(encoding="utf-8"))
    by_title = {t.title: t.tags for t in re_parsed}
    assert by_title["TDengine 时序数据库整库告警监控"] == ["监控", "钉钉", "时序"]
    assert by_title["漏洞修复"] == ["安全", "Redis", "升级"]


def test_import_to_db_empty_tags(con):
    """无标签行时，tags 应为空列表，不是 None。"""
    md = """## 无标签测试

**任务基本信息**

| 项目 | 描述 |
| --- | --- |
| 任务描述 | test |
| 任务性质 | 长期 |
| 任务完成状态 | 进行中 |

**任务处理情况**

|  |  |
| --- | --- |

**任务总结**

```
无
```
"""
    tasks = parse_md(md)
    assert tasks[0].tags == []
    import_to_db(con, tasks)
    row = con.execute(
        "SELECT tags FROM tasks WHERE title = ?", ["无标签测试"]
    ).fetchone()
    assert row is not None
    assert list(row[0] or []) == []
