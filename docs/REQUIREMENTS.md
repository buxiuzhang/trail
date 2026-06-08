# Trail v2 · 项目需求说明

> 给未来的我 / 大模型看的项目说明。

## 1. 一句话

**Web 形态的任务填报工具** + **大模型在操作流内做辅助**（润色、总结、询问维护阶段）。不做主动推送、不做桌面机器人。

## 2. 痛点

- 任务碎片化
- 经常忘记更新状态
- 任务完成后还有偶发小调整（不应再起新任务）

## 3. 形态

- **后端**：Python 3.12 + FastAPI
- **前端**：单页 HTML + 原生 JS（fetch 调用 API）。不引入任何前端框架。
- **DB**：DuckDB 单文件 `data/tasks.duckdb`
- **LLM**：Anthropic Python SDK（兼容 OpenAI-compatible 代理）。`trail_app/llm_service.py` 封装 4 个函数：polish / summarize_main / summarize_maintenance / ask_maintenance；chat 走 Anthropic 协议原生 tool use 多轮循环（详见 `docs/CHAT_TOOLS.md`）。Base URL 通过 `ANTHROPIC_BASE_URL` 环境变量指定（项目里常用 `https://api.minimaxi.com/anthropic`），model 走 `ANTHROPIC_DEFAULT_HAIKU_MODEL`。
- **配置**：`data/config.yaml`（git 忽略）。优先级：环境变量 > yaml > 内置默认。API key 永不落库 / 不入 prompt / 不入 ai_records。
- **入口**：`python -m trail_app.web`（默认端口 8765）

## 4. 数据模型

详见 `docs/SCHEMA.md`。要点：

- `tasks` 主表，`work_logs` 工作日志（按 `phase` 区分 main/maintenance），`ai_records` 大模型操作审计。
- 任务 ID = DB 自增 `BIGINT`（`nextval('tasks_id_seq')`），永不变。
- work_logs：可编辑（content / log_date / phase 三字段 PUT）、可软删（`is_deleted=TRUE`）；ai_records 仍 append-only。

## 5. 状态机（5 态）

```
未开始 ─┬─→ 进行中 ─┬─→ 已完成   （完成流程弹窗选"不再维护"）
        │          ├─→ 维护中   （完成流程弹窗选"含维护"）
        │          └─→ 已作废
        ├─→ 已作废
        └──────────→ 已作废

已完成 ──→ 维护中  （用户手动改）
已完成 ──→ 进行中  （重新开启）
维护中 ──→ 已完成  （改回）
维护中 ──→ 进行中  （维护范围扩大）
已作废 终态
```

## 6. 大模型介入点

| 触发 | 行为 |
| --- | --- |
| 落档前润色草稿 | LLM 改写 textarea 内文本 → 用户在落档前确认（M2 stub，M3 接真 LLM） |
| 落档后润色某条 | LLM 改写 → 写 `polished_content`（M3，原始 `content` 不动） |
| 任务标记完成 | LLM 生成主体总结 → 弹窗问"含维护 / 不再维护" |
| 维护期生成总结 | LLM 基于 maintenance 日志生成 |
| 聊天（多轮 tool use 协议） | LLM 主动调 list_tasks / list_recent_logs / get_task_detail / count_tasks_by_status / ask_maintenance_suggestion，详见 `docs/CHAT_TOOLS.md` |
| 过期任务盘点 | 本地规则，无 LLM |

**硬规则**：LLM 永不直写库。所有写入用户显式确认。

## 7. md ↔ DB

- `scripts/md_to_duckdb.py`：md → DB（按 id 幂等跳过，--recreate 清空重建）
- `scripts/duckdb_to_md.py`：DB → md（默认导全部，--only-open 过滤）
- 字段映射见 `docs/SCHEMA.md` 末尾

## 8. 不做

- ❌ 主动推送 / 定时通知
- ❌ 多用户 / 权限
- ❌ 移动端适配 / 主题切换
- ❌ 任务依赖 / 子任务
- ❌ 附件上传

## 9. 改了要同步

- 表结构 → 同步 `docs/SCHEMA.md` 与 `trail_app/db.py` 的 `_DDL`
- md 字段 → 同步 `trail_app/md_io.py`
- 依赖 → 同步 `requirements.txt` 和 `setup.py`
