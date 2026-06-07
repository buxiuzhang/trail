# CLAUDE.md

本文件供 Claude Code 读取。**所有对话、注释、文档用中文。**

## 项目

Trail v2 —— **任务填报 + 大模型辅助的 Web 工具**。

形态：Web（FastAPI + 原生 HTML/JS）。数据存 DuckDB 单文件。

## 方向

- **不要**做 GUI 悬浮窗 / 桌面机器人 / 主动推送通知（旧版已放弃）。
- 用户**主动**填任务基本信息 + 每天工作日志。
- 大模型**在操作流内**做辅助：润色日志、生成总结、询问是否进入维护阶段。
- "维护阶段"是任务完成后偶有零星调整的状态，由用户**当场**选，不主动推送。

完整方向见 `docs/REQUIREMENTS.md`，表结构见 `docs/SCHEMA.md`。

## 常用命令

```bash
# 安装
pip install -r requirements.txt
pip install -e .

# 数据：md ↔ DuckDB
python scripts/md_to_duckdb.py                # md 灌库（按 id 幂等跳过）
python scripts/md_to_duckdb.py --recreate     # 清空重建
python scripts/duckdb_to_md.py                # 导出 md 到 data/export/
python scripts/duckdb_to_md.py --only-open    # 仅导进行中/未开始/维护中

# 启动 Web（M2 之后才有）
python -m trail_app.web                      # 默认 http://127.0.0.1:8765

# 测试
pytest
pytest tests/test_md_io.py
```

## 数据位置

- 库：`data/tasks.duckdb`（首次运行自动创建，git 忽略）
- 配置文件：`data/config.yaml`（git 忽略）
- 导出 md：`data/export/任务需求-YYYY-MM-DD.md`

## 代码布局

```
trail_app/
├── __init__.py
├── utils.py         # 数据目录路径
├── models.py        # dataclass + 枚举（5 状态、ChannelKind/Platform）
├── db.py            # DuckDB 连接 + schema + 旧版一次性迁移
├── store.py         # TaskStore / WorkLogStore / ContactStore / AiRecordStore / InsightStore
├── md_io.py         # md ↔ DB 转换（含任务对接多行解析）
├── config.py        # YAML + 环境变量（LLM 配置：ANTHROPIC_*_URL / _API_KEY / _DEFAULT_*_MODEL）
├── llm_service.py   # anthropic SDK 封装：polish / summarize_main / summarize_maintenance / ask_maintenance
├── prompts.py       # 4 套 prompt 模板（polish / summarize_main / summarize_maintenance / ask_maintenance）
├── web/             # FastAPI
│   ├── main.py
│   ├── schemas.py   # Pydantic：TaskCreate/Update/Out、ContactIn/Out
│   ├── deps.py
│   └── routes/      # tasks / logs / insights
└── __main__.py      # python -m trail_app.web 入口

scripts/
├── md_to_duckdb.py
└── duckdb_to_md.py

tests/
├── conftest.py
├── test_md_io.py
└── test_web_api.py
```

## 关键不变量

- **任务 ID = DB 自增 BIGINT**（`nextval('tasks_id_seq')`），**永不变**——改名、编辑都不换 id。
- **对接渠道 = 独立子表 `contact_channels`**（两维度：`kind` × `channel`）。任务不再有 `contact` 字段。
- **任务别名 = `alias VARCHAR`**（可空，口头沟通用）。
- **work_logs 可编辑、可软删**（content / log_date / phase 三字段允许 PUT；DELETE 走软删 `is_deleted=TRUE`，列表默认过滤）。`ai_records` 仍 append-only。
- **ai_records append-only**（M3）：所有 LLM 调用的 prompt + response 落库；`user_confirmed` 字段记录用户是否采纳。
- **LLM 永不直写库**——所有写入用户显式确认。LLM endpoint 只返回文本，前端弹窗让用户点确认后才调 PUT/POST 落 DB。
- **API key 不入 DB / 不入 prompt / 不入 ai_records**——只从 env（`ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL`）或 `data/config.yaml` 读。
- **DuckDB FK 不支持 CASCADE**：`TaskStore.delete_task` 手动按子表 → 主表顺序删。
- **状态机**：`未开始 / 进行中 / 已作废 / 已完成 / 维护中`，后端校验合法转移。
- **LLM 永不直写库**——所有写入用户显式确认。
- **API key 不入 DB**——只在 config.yaml 或环境变量。

## 维护期约定（M3 时落实）

- 状态从 `进行中` 走完成流程时，弹窗问"含维护 / 不再维护"。
- 维护期日志 `phase = 'maintenance'`，主体日志 `phase = 'main'`。
- 维护期总结写到 `tasks.maintenance_summary`（v1 追加式）。
