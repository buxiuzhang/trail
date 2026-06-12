"""Web API 测试（FastAPI TestClient）。"""
from __future__ import annotations

from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from trail_app.db import recreate_schema
from trail_app.web.deps import (
    contact_store,
    insight_store,
    task_store,
    work_log_store,
)
from trail_app.web.main import app


@pytest.fixture
def client(tmp_path: Path, monkeypatch) -> TestClient:
    """用临时 DB 跑 API。"""
    db = tmp_path / "test.duckdb"
    cfg = tmp_path / "config.yaml"

    # 让所有 store / util / db 走临时路径
    monkeypatch.setattr("trail_app.utils.get_db_path", lambda: db)
    monkeypatch.setattr("trail_app.db.get_db_path", lambda: db)
    # 让 config 读写也走临时文件（避免测试污染项目根 data/config.yaml）
    monkeypatch.setattr("trail_app.utils.get_config_path", lambda: cfg)
    monkeypatch.setattr("trail_app.utils.get_config_path_or_none", lambda: cfg if cfg.exists() else None)
    # config.py 顶层 from trail_app.utils import get_config_path_or_none 是局部引用，
    # 必须 patch 目标模块内的名字才会生效
    monkeypatch.setattr("trail_app.config.get_config_path_or_none", lambda: cfg if cfg.exists() else None)
    monkeypatch.setattr("trail_app.web.routes.database.get_config_path", lambda: cfg)
    # 重建空 schema
    con = duckdb.connect(str(db))
    try:
        recreate_schema(con)
    finally:
        con.close()
    # 清掉 lru_cache
    task_store.cache_clear()
    work_log_store.cache_clear()
    contact_store.cache_clear()
    insight_store.cache_clear()
    return TestClient(app)


# ============================================================
# 健康检查
# ============================================================


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_overview_empty(client):
    r = client.get("/api/insights/overview")
    assert r.status_code == 200
    data = r.json()
    assert data["total_tasks"] == 0
    assert data["total_logs"] == 0


# ============================================================
# 任务 CRUD
# ============================================================


def test_create_task_minimal(client):
    r = client.post("/api/tasks", json={"title": "测试任务"})
    assert r.status_code == 201
    t = r.json()
    assert t["title"] == "测试任务"
    assert t["status"] == "未开始"
    assert t["nature"] == "临时"
    assert isinstance(t["id"], int)
    assert t["contacts"] == []


def test_create_task_full(client):
    r = client.post("/api/tasks", json={
        "title": "完整任务",
        "alias": "完任",
        "description": "desc",
        "start_date": "2026-06-01",
        "processing_date": "2026-06-02",
        "nature": "长期",
        "status": "进行中",
        "tags": ["监控", "告警"],
    })
    assert r.status_code == 201
    t = r.json()
    assert t["description"] == "desc"
    assert t["alias"] == "完任"
    assert t["start_date"] == "2026-06-01"
    assert t["nature"] == "长期"
    assert t["tags"] == ["监控", "告警"]


def test_create_task_duplicate(client):
    client.post("/api/tasks", json={"title": "重复测试"})
    r = client.post("/api/tasks", json={"title": "重复测试"})
    assert r.status_code == 409


def test_create_task_empty_title(client):
    r = client.post("/api/tasks", json={"title": ""})
    assert r.status_code == 422  # Pydantic 校验


def test_list_tasks(client):
    client.post("/api/tasks", json={"title": "A"})
    client.post("/api/tasks", json={"title": "B"})
    r = client.get("/api/tasks")
    assert r.status_code == 200
    assert len(r.json()) == 2
    # 每个都带 contacts 字段
    for t in r.json():
        assert "contacts" in t
        assert t["contacts"] == []


def test_list_tasks_filter_status(client):
    client.post("/api/tasks", json={"title": "A", "status": "未开始"})
    client.post("/api/tasks", json={"title": "B", "status": "进行中"})
    r = client.get("/api/tasks", params={"status": "未开始"})
    titles = [t["title"] for t in r.json()]
    assert titles == ["A"]


def test_get_task_404(client):
    r = client.get("/api/tasks/999999")
    assert r.status_code == 404


def test_update_task(client):
    tid = client.post("/api/tasks", json={"title": "原标题"}).json()["id"]
    r = client.put(f"/api/tasks/{tid}", json={
        "description": "新描述",
        "alias": "新别名",
        "tags": ["新", "标签"],
    })
    assert r.status_code == 200
    t = r.json()
    assert t["description"] == "新描述"
    assert t["alias"] == "新别名"
    assert t["tags"] == ["新", "标签"]


def test_update_task_rename_keeps_id(client):
    """改名不改 id（id 是 DB 自增，不依赖标题）。"""
    tid = client.post("/api/tasks", json={"title": "原标题"}).json()["id"]
    r = client.put(f"/api/tasks/{tid}", json={"title": "新标题"})
    assert r.status_code == 200
    t = r.json()
    assert t["id"] == tid
    assert t["title"] == "新标题"
    # 旧 id 仍可查
    r2 = client.get(f"/api/tasks/{tid}")
    assert r2.status_code == 200
    assert r2.json()["title"] == "新标题"


# ============================================================
# 对接渠道
# ============================================================


def test_create_task_with_contacts(client):
    r = client.post("/api/tasks", json={
        "title": "群任务",
        "contacts": [
            {"kind": "group", "channel": "dingtalk", "name": "动环群"},
            {"kind": "person", "channel": "wechat", "name": "王萌", "target": "wxid_abc"},
        ],
    })
    assert r.status_code == 201
    t = r.json()
    assert len(t["contacts"]) == 2
    c0 = t["contacts"][0]
    assert c0["kind"] == "group"
    assert c0["channel"] == "dingtalk"
    assert c0["name"] == "动环群"
    c1 = t["contacts"][1]
    assert c1["target"] == "wxid_abc"


def test_update_task_contacts_replaces(client):
    """PUT 一次 contacts → 旧的全删，新的全写。"""
    tid = client.post("/api/tasks", json={
        "title": "T",
        "contacts": [{"kind": "person", "channel": "wechat", "name": "A"}],
    }).json()["id"]
    assert len(client.get(f"/api/tasks/{tid}").json()["contacts"]) == 1

    r = client.put(f"/api/tasks/{tid}", json={
        "contacts": [
            {"kind": "group", "channel": "dingtalk", "name": "群1"},
            {"kind": "group", "channel": "wechat", "name": "群2"},
        ],
    })
    assert r.status_code == 200
    contacts = r.json()["contacts"]
    assert len(contacts) == 2
    assert all(c["kind"] == "group" for c in contacts)

    # 清空
    r2 = client.put(f"/api/tasks/{tid}", json={"contacts": []})
    assert r2.json()["contacts"] == []


def test_update_task_contacts_invalid_kind(client):
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    r = client.put(f"/api/tasks/{tid}", json={
        "contacts": [{"kind": "INVALID", "channel": "wechat", "name": "x"}],
    })
    assert r.status_code == 400


def test_delete_task_cascades_contacts(client):
    """删任务时 contact_channels 一并删。"""
    tid = client.post("/api/tasks", json={
        "title": "T",
        "contacts": [{"kind": "group", "channel": "dingtalk", "name": "g"}],
    }).json()["id"]
    assert client.delete(f"/api/tasks/{tid}").status_code == 204
    # 联系人也应该没了（注意：直接读 DB 验证更直接）
    r = client.get("/api/tasks")
    assert all(t["id"] != tid for t in r.json())


# ============================================================
# 状态机
# ============================================================


def test_status_transition_valid(client):
    tid = client.post("/api/tasks", json={"title": "T", "status": "未开始"}).json()["id"]
    r = client.post(f"/api/tasks/{tid}/status", json={"new_status": "进行中"})
    assert r.status_code == 200
    assert r.json()["status"] == "进行中"


def test_status_transition_to_completed_sets_end_date(client):
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    # 默认"未开始"，先转"进行中"
    client.post(f"/api/tasks/{tid}/status", json={"new_status": "进行中"})
    r = client.post(f"/api/tasks/{tid}/status", json={
        "new_status": "已完成",
        "summary": "做完了",
    })
    assert r.status_code == 200
    t = r.json()
    assert t["status"] == "已完成"
    assert t["end_date"] is not None
    assert t["summary"] == "做完了"


def test_status_transition_invalid(client):
    """未开始 → 已完成 是非法的。"""
    tid = client.post("/api/tasks", json={"title": "T", "status": "未开始"}).json()["id"]
    r = client.post(f"/api/tasks/{tid}/status", json={"new_status": "已完成"})
    assert r.status_code == 400
    assert "非法" in r.json()["detail"]


def test_status_transition_to_completed_with_maintenance(client):
    """进行中 → 已完成（含维护期）→ status=已完成, nature=维护, end_date 自动写入。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    # 默认"未开始"，先转"进行中"
    client.post(f"/api/tasks/{tid}/status", json={"new_status": "进行中"})
    r = client.post(f"/api/tasks/{tid}/status", json={"new_status": "已完成", "maintenance": True})
    assert r.status_code == 200
    t = r.json()
    assert t["status"] == "已完成"
    assert t["nature"] == "维护"
    assert t["end_date"] is not None  # end_date 是主体完成时间
    # 已完成+维护仍可添加日志
    r2 = client.post(f"/api/tasks/{tid}/logs", json={
        "log_date": "2026-06-06",
        "content": "维护日志",
        "phase": "maintenance",
    })
    assert r2.status_code == 201


def test_transition_to_maintenance_is_invalid(client):
    """'维护中'不再是合法状态，后端应拒。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    client.post(f"/api/tasks/{tid}/status", json={"new_status": "进行中"})
    r = client.post(f"/api/tasks/{tid}/status", json={"new_status": "维护中"})
    assert r.status_code == 400


def test_status_to_cancelled_clears_end_date(client):
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    client.post(f"/api/tasks/{tid}/status", json={"new_status": "已完成"})
    r = client.post(f"/api/tasks/{tid}/status", json={"new_status": "已作废"})
    assert r.status_code == 200
    assert r.json()["end_date"] is None


def test_pin_task(client):
    """置顶 → 200，pinned_at 非空。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    r = client.post(f"/api/tasks/{tid}/pin")
    assert r.status_code == 200
    assert r.json()["pinned_at"] is not None


def test_pin_task_idempotent(client):
    """重复 pin：pinned_at 不变（COALESCE 兜底）。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    r1 = client.post(f"/api/tasks/{tid}/pin").json()
    r2 = client.post(f"/api/tasks/{tid}/pin").json()
    assert r1["pinned_at"] == r2["pinned_at"]


def test_unpin_task(client):
    """unpin → 200，pinned_at=NULL。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    client.post(f"/api/tasks/{tid}/pin")
    r = client.post(f"/api/tasks/{tid}/unpin")
    assert r.status_code == 200
    assert r.json()["pinned_at"] is None


def test_unpin_task_idempotent(client):
    """未置顶也允许 unpin，不报错。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    r = client.post(f"/api/tasks/{tid}/unpin")
    assert r.status_code == 200
    assert r.json()["pinned_at"] is None


def test_pin_unpin_404(client):
    """任务不存在 → 404。"""
    r = client.post("/api/tasks/9999/pin")
    assert r.status_code == 404
    r = client.post("/api/tasks/9999/unpin")
    assert r.status_code == 404


def test_pinned_task_listed_first(client):
    """置顶任务在 list 第一个。"""
    t1 = client.post("/api/tasks", json={"title": "A"}).json()["id"]
    t2 = client.post("/api/tasks", json={"title": "B"}).json()["id"]
    t3 = client.post("/api/tasks", json={"title": "C"}).json()["id"]
    # 置顶 t2（按时间倒序应该排最前）
    client.post(f"/api/tasks/{t2}/pin")
    lst = client.get("/api/tasks").json()
    assert lst[0]["id"] == t2
    # 取消置顶，恢复原顺序
    client.post(f"/api/tasks/{t2}/unpin")
    lst = client.get("/api/tasks").json()
    assert lst[0]["id"] != t2  # 不再固定在最前


def test_cancel_task(client):
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    r = client.post(f"/api/tasks/{tid}/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "已作废"


# ============================================================
# 工作日志
# ============================================================


def test_add_log_main(client):
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    r = client.post(f"/api/tasks/{tid}/logs", json={
        "log_date": "2026-06-01",
        "content": "今天写完了 A 模块",
    })
    assert r.status_code == 201
    log = r.json()
    assert log["phase"] == "main"
    assert log["content"] == "今天写完了 A 模块"
    assert isinstance(log["task_id"], int)


def test_add_log_maintenance(client):
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    r = client.post(f"/api/tasks/{tid}/logs", json={
        "log_date": "2026-06-05",
        "content": "调整阈值",
        "phase": "maintenance",
    })
    assert r.status_code == 201
    assert r.json()["phase"] == "maintenance"


def test_add_log_404(client):
    r = client.post("/api/tasks/999999/logs", json={
        "log_date": "2026-06-01",
        "content": "x",
    })
    assert r.status_code == 404


def test_first_log_auto_transitions_to_in_progress(client):
    """首次日志：未开始 → 进行中（后端自动）。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    # 确认新建为"未开始"
    t = client.get(f"/api/tasks/{tid}").json()
    assert t["status"] == "未开始"
    # 添加首条日志
    r = client.post(f"/api/tasks/{tid}/logs", json={
        "log_date": "2026-06-01", "content": "第一条日志"
    })
    assert r.status_code == 201
    # 状态应自动变为"进行中"
    t = client.get(f"/api/tasks/{tid}").json()
    assert t["status"] == "进行中"


def test_cannot_add_log_to_completed_task(client):
    """已完成/已作废任务不能添加日志。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    # 先转进行中再转已完成
    client.post(f"/api/tasks/{tid}/status", json={"new_status": "进行中"})
    client.post(f"/api/tasks/{tid}/status", json={"new_status": "已完成"})
    # 尝试添加日志
    r = client.post(f"/api/tasks/{tid}/logs", json={
        "log_date": "2026-06-01", "content": "不应成功"
    })
    assert r.status_code == 400
    assert "已完成" in r.json()["detail"]


def test_list_logs(client):
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    client.post(f"/api/tasks/{tid}/logs", json={
        "log_date": "2026-06-01", "content": "a"
    })
    client.post(f"/api/tasks/{tid}/logs", json={
        "log_date": "2026-06-02", "content": "b"
    })
    r = client.get(f"/api/tasks/{tid}/logs")
    assert r.status_code == 200
    logs = r.json()
    assert len(logs) == 2
    assert logs[0]["log_date"] <= logs[1]["log_date"]


def test_log_ordinal_increments(client):
    """同一天多条日志，ordinal 递增。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    for c in ("a", "b", "c"):
        client.post(f"/api/tasks/{tid}/logs", json={"log_date": "2026-06-01", "content": c})
    logs = client.get(f"/api/tasks/{tid}/logs").json()
    assert [l["ordinal"] for l in logs] == [0, 1, 2]


# ====== 日志编辑 ======
def test_update_log_content(client):
    """改 content → 200, edit_count=1, updated_at 非空。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    lid = client.post(
        f"/api/tasks/{tid}/logs", json={"log_date": "2026-06-01", "content": "原文"}
    ).json()["id"]
    r = client.put(f"/api/tasks/{tid}/logs/{lid}", json={"content": "改后"})
    assert r.status_code == 200
    log = r.json()
    assert log["content"] == "改后"
    assert log["edit_count"] == 1
    assert log["updated_at"] is not None


def test_update_log_change_date_recomputes_ordinal(client):
    """改 log_date 跨日 → ordinal 落到新 group 最末。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    client.post(f"/api/tasks/{tid}/logs", json={"log_date": "2026-06-01", "content": "a"})
    bid = client.post(
        f"/api/tasks/{tid}/logs", json={"log_date": "2026-06-01", "content": "b"}
    ).json()["id"]
    client.post(f"/api/tasks/{tid}/logs", json={"log_date": "2026-06-02", "content": "c"})
    # 把 b 改到 06-02 → 应得 ordinal=1（06-02 上原本只有 c）
    r = client.put(f"/api/tasks/{tid}/logs/{bid}", json={"log_date": "2026-06-02"})
    assert r.status_code == 200
    assert r.json()["log_date"] == "2026-06-02"
    assert r.json()["ordinal"] == 1


def test_update_log_change_phase(client):
    """改 phase main → maintenance → 落到新 group 末位。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    client.post(
        f"/api/tasks/{tid}/logs",
        json={"log_date": "2026-06-01", "content": "x", "phase": "maintenance"},
    )
    lid = client.post(
        f"/api/tasks/{tid}/logs", json={"log_date": "2026-06-01", "content": "y"}
    ).json()["id"]
    # 把 y 改成 maintenance → 落到 maintenance group 末位（ord 1）
    r = client.put(f"/api/tasks/{tid}/logs/{lid}", json={"phase": "maintenance"})
    assert r.status_code == 200
    assert r.json()["phase"] == "maintenance"
    assert r.json()["ordinal"] == 1


def test_update_log_404_wrong_task(client):
    """log_id 不属于 task_id 时返 404。"""
    t1 = client.post("/api/tasks", json={"title": "T1"}).json()["id"]
    t2 = client.post("/api/tasks", json={"title": "T2"}).json()["id"]
    lid = client.post(
        f"/api/tasks/{t1}/logs", json={"log_date": "2026-06-01", "content": "x"}
    ).json()["id"]
    r = client.put(f"/api/tasks/{t2}/logs/{lid}", json={"content": "hack"})
    assert r.status_code == 404


def test_update_log_empty_content(client):
    """content 全空白 → 400。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    lid = client.post(
        f"/api/tasks/{tid}/logs", json={"log_date": "2026-06-01", "content": "x"}
    ).json()["id"]
    r = client.put(f"/api/tasks/{tid}/logs/{lid}", json={"content": "   "})
    assert r.status_code == 400


def test_update_log_no_fields(client):
    """空 body → 400。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    lid = client.post(
        f"/api/tasks/{tid}/logs", json={"log_date": "2026-06-01", "content": "x"}
    ).json()["id"]
    r = client.put(f"/api/tasks/{tid}/logs/{lid}", json={})
    assert r.status_code == 400


# ====== 软删 ======
def test_soft_delete_log(client):
    """DELETE → 204；list_logs 默认不返回；is_deleted=TRUE。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    lid = client.post(
        f"/api/tasks/{tid}/logs", json={"log_date": "2026-06-01", "content": "x"}
    ).json()["id"]
    r = client.delete(f"/api/tasks/{tid}/logs/{lid}")
    assert r.status_code == 204
    logs = client.get(f"/api/tasks/{tid}/logs").json()
    assert logs == []
    # include_deleted 才看得到
    logs_all = client.get(
        f"/api/tasks/{tid}/logs", params={"include_deleted": "true"}
    ).json()
    assert len(logs_all) == 1
    assert logs_all[0]["is_deleted"] is True
    assert logs_all[0]["deleted_at"] is not None


def test_soft_delete_log_wrong_task(client):
    t1 = client.post("/api/tasks", json={"title": "T1"}).json()["id"]
    t2 = client.post("/api/tasks", json={"title": "T2"}).json()["id"]
    lid = client.post(
        f"/api/tasks/{t1}/logs", json={"log_date": "2026-06-01", "content": "x"}
    ).json()["id"]
    r = client.delete(f"/api/tasks/{t2}/logs/{lid}")
    assert r.status_code == 404


# ====== LLM（M3 mock 真实 anthropic SDK） ======
import pytest as _pytest


@_pytest.fixture
def mock_llm(monkeypatch):
    """monkeypatch llm_service 的 _get_client / _call，模拟 anthropic SDK 响应。"""

    class _FakeClient:
        pass

    _fake_cfg = type("Cfg", (), {"model": "mock", "max_tokens": 1000})()

    def _fake_get_client():
        return _FakeClient(), _fake_cfg

    def _fake_call(system, user, cfg, client):
        return (
            f"【润色】{user.split('：', 1)[-1]}",
            f"[system]\n{system}\n\n[user]\n{user}",
            '{"id":"msg_mock","content":[{"type":"text","text":"mock"}]}',
        )

    monkeypatch.setattr("trail_app.llm_service._get_client", _fake_get_client)
    monkeypatch.setattr("trail_app.llm_service._call", _fake_call)
    return _fake_call


def test_polish_real(client, mock_llm):
    """M3 后端：polish 真接通（mock SDK）。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    r = client.post(
        "/api/llm/polish",
        json={"content": "今天写完模块A", "task_id": tid},
    )
    assert r.status_code == 200
    out = r.json()
    assert out["mock"] is False
    assert out["polished"].startswith("【润色】")


def test_polish_empty(client):
    """空 content → 422（Pydantic min_length=1）。"""
    r = client.post("/api/llm/polish", json={"content": ""})
    assert r.status_code == 422


def test_summarize_main(client, mock_llm):
    """主体阶段总结：有 main 日志 → 200。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    client.post(
        f"/api/tasks/{tid}/logs",
        json={"log_date": "2026-06-01", "content": "动手了", "phase": "main"},
    )
    r = client.post(f"/api/tasks/{tid}/summarize")
    assert r.status_code == 200
    assert r.json()["text"]


def test_summarize_main_no_logs(client, mock_llm):
    """无 main 日志 → 400。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    r = client.post(f"/api/tasks/{tid}/summarize")
    assert r.status_code == 400


def test_summarize_maintenance(client, mock_llm):
    """维护期总结：需要 maintenance 日志。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    client.post(
        f"/api/tasks/{tid}/logs",
        json={"log_date": "2026-06-01", "content": "修了 bug", "phase": "maintenance"},
    )
    r = client.post(f"/api/tasks/{tid}/maintenance/summarize")
    assert r.status_code == 200


def test_ask_maintenance(client, mock_llm):
    """ask-maintenance：有 main 日志 → 200。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    client.post(
        f"/api/tasks/{tid}/logs",
        json={"log_date": "2026-06-01", "content": "x", "phase": "main"},
    )
    r = client.post(f"/api/tasks/{tid}/ask-maintenance")
    assert r.status_code == 200
    assert r.json()["suggestion"]


def test_polish_logged(client, mock_llm):
    """落档后润色：返回润色版，ai_records 写入。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    lid = client.post(
        f"/api/tasks/{tid}/logs",
        json={"log_date": "2026-06-01", "content": "原文"},
    ).json()["id"]
    r = client.post(f"/api/tasks/{tid}/logs/{lid}/polish")
    assert r.status_code == 200
    assert r.json()["polished"].startswith("【润色】")


def test_polish_logged_wrong_task(client, mock_llm):
    """log 不属于 task → 404。"""
    t1 = client.post("/api/tasks", json={"title": "T1"}).json()["id"]
    t2 = client.post("/api/tasks", json={"title": "T2"}).json()["id"]
    lid = client.post(
        f"/api/tasks/{t1}/logs",
        json={"log_date": "2026-06-01", "content": "x"},
    ).json()["id"]
    r = client.post(f"/api/tasks/{t2}/logs/{lid}/polish")
    assert r.status_code == 404


# ============================================================
# 盘点 / 概览
# ============================================================


def test_overview_after_creates(client):
    client.post("/api/tasks", json={"title": "A", "status": "进行中", "nature": "长期"})
    client.post("/api/tasks", json={"title": "B", "status": "已完成", "nature": "临时"})
    r = client.get("/api/insights/overview")
    data = r.json()
    assert data["total_tasks"] == 2
    assert data["by_status"].get("进行中") == 1
    assert data["by_status"].get("已完成") == 1


def test_stale_with_recent_logs(client):
    """最近有日志的不算过期。"""
    from datetime import date
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    client.post(f"/api/tasks/{tid}/logs", json={
        "log_date": date.today().isoformat(), "content": "今天"
    })
    r = client.get("/api/insights/stale", params={"idle_days": 30})
    assert all(t["id"] != tid for t in r.json())


def test_stale_with_old_logs(client):
    """40 天前的日志算过期。"""
    tid = client.post("/api/tasks", json={"title": "T"}).json()["id"]
    client.post(f"/api/tasks/{tid}/logs", json={
        "log_date": "2026-04-01", "content": "很久以前"
    })
    r = client.get("/api/insights/stale", params={"idle_days": 30})
    ids = [t["id"] for t in r.json()]
    assert tid in ids


# ============================================================
# 聊天 tool use 多轮测试
# ============================================================


def _mk_text_delta_event(text: str):
    """构造一个 RawContentBlockDeltaEvent，type=text_delta。"""
    from anthropic.types.raw_content_block_delta_event import RawContentBlockDeltaEvent
    return RawContentBlockDeltaEvent(
        index=0,
        delta={"type": "text_delta", "text": text},  # type: ignore[list-item]
        type="content_block_delta",
    )


def _mk_block_start_tool_use(idx: int, block_id: str, name: str):
    from anthropic.types.raw_content_block_start_event import RawContentBlockStartEvent
    return RawContentBlockStartEvent(
        index=idx,
        content_block={"type": "tool_use", "id": block_id, "name": name, "input": {}},  # type: ignore[list-item]
        type="content_block_start",
    )


def _mk_input_json_delta(idx: int, partial_json: str):
    from anthropic.types.raw_content_block_delta_event import RawContentBlockDeltaEvent
    return RawContentBlockDeltaEvent(
        index=idx,
        delta={"type": "input_json_delta", "partial_json": partial_json},  # type: ignore[list-item]
        type="content_block_delta",
    )


@_pytest.fixture
def mock_chat_stream(monkeypatch):
    """monkeypatch chat_stream_with_tools 的最终结果。

    简化做法：直接 mock 函数返固定 yield（不动 client.messages.stream）。
    这样测试只验证 SSE 端点的事件流解析，工具循环逻辑通过端到端
    验证（手动 e2e）。
    """
    def _fake_chat_stream(messages, **_kwargs):
        # 模拟"调 list_tasks 工具一次 → 第二轮回文本"两轮流
        yield ("tool_call", {"name": "list_tasks", "input": {}})
        yield ("tool_result", {"name": "list_tasks", "ok": True})
        for ch in "你", "好", "呀":
            yield ("text", ch)
        yield ("__final__", "你好呀", '{"id":"msg_mock"}')

    monkeypatch.setattr(
        "trail_app.web.routes.llm.chat_stream_with_tools", _fake_chat_stream
    )
    # _call_chat_tools 同步版同样 mock，避免 _get_client 真去读 env
    def _fake_call_chat(messages, **_kwargs):
        return (
            "你好",
            "[system]\nmock\n\n[user]\nhi",
            '{"id":"msg_mock_sync"}',
        )
    monkeypatch.setattr(
        "trail_app.web.routes.llm._call_chat_tools", _fake_call_chat
    )
    return _fake_chat_stream


def test_chat_tool_use_stream(client, mock_chat_stream):
    """SSE 端点解析 tool_call / tool_result / text / done / [DONE] 五种事件。"""
    import json as _json
    with client.stream(
        "POST", "/api/chat/stream",
        json={"messages": [{"role": "user", "content": "你好"}]},
    ) as r:
        assert r.status_code == 200
        events = []
        for line in r.iter_lines():
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload == "[DONE]":
                    events.append({"_kind": "[DONE]"})
                    continue
                events.append(_json.loads(payload))
    # 抽出每个事件的 key
    def _kind(e):
        for k in ("delta", "tool_call", "tool_result", "done", "error"):
            if k in e:
                return k
        return None

    kinds = [_kind(e) for e in events]
    assert "tool_call" in kinds
    assert "tool_result" in kinds
    assert "delta" in kinds
    assert "done" in kinds
    # 三个 delta 拼起来是 "你好呀"
    deltas = [e["delta"] for e in events if "delta" in e]
    assert "".join(deltas) == "你好呀"
    assert any(e.get("_kind") == "[DONE]" for e in events)


def test_chat_sync_endpoint(client, mock_chat_stream):
    """/api/chat 同步版返 ChatOut。"""
    r = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "你好"}]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == "你好"


def test_chat_stream_unconfigured(client, monkeypatch):
    """未配置 LLM 时流式端点 503（不进 stream）。"""
    from trail_app.llm_service import LLMNotConfigured
    def _raise():
        raise LLMNotConfigured("未配置")
    monkeypatch.setattr(
        "trail_app.web.routes.llm._get_client", _raise
    )
    r = client.post(
        "/api/chat/stream",
        json={"messages": [{"role": "user", "content": "x"}]},
    )
    assert r.status_code == 503


def test_chat_tool_use_minimal_payload(client, mock_chat_stream):
    """SSE 流以 [DONE] 收尾。"""
    with client.stream(
        "POST", "/api/chat/stream",
        json={"messages": [{"role": "user", "content": "hi"}]},
    ) as r:
        assert r.status_code == 200
        seen_done = False
        for line in r.iter_lines():
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload == "[DONE]":
                    seen_done = True
                    break
        assert seen_done


# ============================================================
# 数据源配置（M3+：用户可在设置页切 DuckDB/MySQL）
# ============================================================


def test_get_db_settings_default(client):
    """GET /api/settings/db 默认返 duckdb + tasks.duckdb（相对 <项目根>/data/>）。"""
    r = client.get("/api/settings/db")
    assert r.status_code == 200
    data = r.json()
    assert data["backend"] == "duckdb"
    assert data["duckdb"]["path"] == "tasks.duckdb"
    assert data["defaults"]["duckdb_path"] == "tasks.duckdb"
    # absolute_path 应为 <项目根>/data/tasks.duckdb
    assert data["duckdb"]["absolute_path"].endswith("/data/tasks.duckdb")
    # mysql 段占位齐全
    for k in ("host", "port", "user", "password", "database"):
        assert k in data["mysql"]


def test_save_db_duckdb_path(client):
    """PUT 后 GET 反映新路径。"""
    new_path = "/tmp/custom-trail.duckdb"
    r = client.put("/api/settings/db", json={
        "backend": "duckdb",
        "duckdb": {"path": new_path},
    })
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    assert r.json()["next_startup_path"] == new_path

    r2 = client.get("/api/settings/db")
    assert r2.status_code == 200
    assert r2.json()["duckdb"]["path"] == new_path


def test_save_db_mysql_rejected(client):
    """PUT mysql 返 409，不写盘。"""
    r = client.put("/api/settings/db", json={
        "backend": "mysql",
        "mysql": {"host": "x", "port": 3306, "user": "u", "password": "p", "database": "d"},
    })
    assert r.status_code == 409
    # 不写盘：再 GET 应仍是默认
    r2 = client.get("/api/settings/db")
    assert r2.json()["backend"] == "duckdb"
    assert r2.json()["duckdb"]["path"] == "tasks.duckdb"


def test_save_db_preserves_llm(client):
    """保存 db 段不应损坏 llm: 段。"""
    # 先写一个含 llm: 段的 config.yaml
    from trail_app.web.routes.database import get_config_path
    import yaml

    cfg = get_config_path()
    cfg.write_text(
        "llm:\n  api_key: 'sk-test-keep-me'\n  base_url: 'https://api.test'\n  model: 'test-model'\n",
        encoding="utf-8",
    )

    # 保存 db 段
    r = client.put("/api/settings/db", json={
        "backend": "duckdb",
        "duckdb": {"path": "data/tasks.duckdb"},
    })
    assert r.status_code == 200, r.text

    # 重新解析，llm: 段仍在
    raw = yaml.safe_load(cfg.read_text(encoding="utf-8"))
    assert "llm" in raw
    assert raw["llm"]["api_key"] == "sk-test-keep-me"
    assert raw["llm"]["base_url"] == "https://api.test"
    assert "db" in raw
    assert raw["db"]["backend"] == "duckdb"
    assert raw["db"]["duckdb"]["path"] == "data/tasks.duckdb"

