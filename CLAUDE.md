# CLAUDE.md

本文件供 Claude Code 读取。**所有对话、注释、文档用中文。**

## 项目

Trail v2 —— **任务填报 + 大模型辅助的 Web 工具**。双后端架构。

不做：GUI 悬浮窗 / 桌面机器人 / 主动推送通知（旧版已放弃）。
大模型只做**操作流内**辅助（润色日志 / 总结 / 询问维护阶段），不主动推送。

详细方向 `docs/REQUIREMENTS.md`、表结构 `docs/SCHEMA.md`、聊天 tool use 协议 `docs/CHAT_TOOLS.md`。

## 技术栈

- **后端（当前）**：`trail_api/`——Java 17 + Spring Boot 3.2 + SQLite（JDBC）。数据目录 `~/.trail/data/`（`db/tasks.sqlite` + `attachments/`）。18 个非 LLM 端点已实现。
- **后端（遗留）**：`trail_app/`——Python 3.12 + FastAPI + DuckDB。LLM 端点在此实现但当前未使用（Java 后端接管端口 8765 后 Python 需先停避免 DuckDB 锁冲突）。
- **前端**：`trail_web/`（Vite + React + TS，独立 npm 包 + 独立 git 仓库，主仓库以 gitlink 记录）。`prototype/` 是早期静态 demo，**已废弃**。前端专属指令见 `trail_web/CLAUDE.md`。
- **DB**：Java 后端用 **SQLite**；Python 遗留用 **DuckDB**。同机不能同时起（DuckDB 单进程独占，SQLite WAL 也建议单进程）。建表 DDL 在 `trail_api/src/main/resources/db/ddl.sql`。
- **配置**：`data/config.yaml`（git 忽略），含 `llm:` 和 `db:` 段。优先级 env > yaml > 内置默认。Java 端另有 `application.yml`。

## 启动 / 常用命令

```bash
# === Java 后端（当前主路） ===
cd trail_api
mvn clean package -DskipTests   # 编译
java -jar target/trail-api.jar  # 启动（端口 8765，数据 ~/.trail/data/）
# 启动前先停 Python（避免 DuckDB 锁冲突）: lsof -i :8765

# 前端（Vite dev，proxy /api → 8765）
cd trail_web && pnpm dev       # http://localhost:5173

# === Python 后端（遗留，LLM 参考） ===
pip install -r requirements.txt && pip install -e .
python -m trail_app.web        # 默认 http://127.0.0.1:8765
# 前端默认加载 trail_web/dist/；用 Vite dev 另起：cd trail_web && pnpm dev

# 数据：md ↔ DuckDB（Python 端工具，SQLite 不可用）
python scripts/md_to_duckdb.py [--recreate]   # 灌库（按 id 幂等；--recreate 清空）
python scripts/duckdb_to_md.py  [--only-open]  # 导出 md 到 data/export/

# 测试
pytest                                           # Python 端
mvn test -Dtest="AttachmentControllerTest"       # Java 端单项
```

## 关键不变量

- **任务 ID = DB 自增 BIGINT**，永不变（改名/编辑/迁移都不换 id）。
- **状态 4 态**：`未开始 / 进行中 / 已完成 / 已作废`。`TaskStatus.all()` 列出，转移合法性在 `store.change_status` 校验。
- **状态由行为驱动，不让用户手选**——前端无 status 切换按钮。
- **性质 `nature` 3 类**（`长期/临时/维护`），**由系统按行为自动判断**，前端无 nature 字段。
- **对接渠道 = 子表 `contact_channels`**（`kind × channel` 两维），任务表不再有 `contact` 字段。
- **`work_logs` 可编辑、可软删**（`content / log_date / phase` PUT；DELETE 走 `is_deleted=TRUE`，列表默认过滤）。`ai_records` append-only。
- **维护期 = `work_logs.phase='maintenance'`**（不是任务状态）。日志阶段 main / maintenance 二选一，与"已完成"独立。
- **LLM 永不直写库**——所有写入用户显式确认；LLM endpoint 只返文本，前端弹窗确认后才调 PUT/POST 落 DB。
- **API key 不入 DB / 不入 prompt / 不入 ai_records**。LLM 配置走 **Fernet 对称加密**存于 DuckDB（`trail_app/crypto.py`，密钥文件 `data/.secret_key` 首次自动生成），读写在 `LLMSettingsStore`（`store.py`）。
- **DuckDB FK 不支持 CASCADE**：`TaskStore.delete_task` 手动按子表 → 主表顺序删。
- **DB 路径可配置 + 切需重启**：`data/config.yaml` 的 `db:` 段控制 backend + 路径；`backend=mysql` 时 `get_db_path()` 返 `None`，`web/main.py` lifespan 直接 `RuntimeError` 拒启动（MySQL 驱动未实现）。前端 `GET/PUT /api/settings/db`（`routes/database.py`）。
- **前端构建产物**默认 `trail_web/dist/`（`web/main.py:34`）；用 `TRAIL_FRONTEND_DIR` 环境变量可指向任意位置。

## LLM

⚠ **当前状态**：Java 后端 LLM 端点尚未实现（阶段 2/3 待实施），前端已通过 `LLM_AVAILABLE = false` 禁用：
- 润色按钮（TaskForm / LogCompose）→ disabled + tooltip "LLM 暂未接入新后端"
- 聊天入口（ChatBubble / ChatWindow）→ 已注释
- SettingsPage 的 LLM 配置仍可使用（走 Java `LlmSettingsController`）

Python 端 LLM 实现参考（等 Java 补完后移除）：
- 4 个同步函数（`llm_service.py`）：`polish` / `summarize_main` / `summarize_maintenance` / `ask_maintenance`。Prompt 模板在 `prompts.py`。
- **聊天走 Anthropic 协议原生 tool use 多轮循环**（`chat_stream_with_tools` / `_call_chat_tools`）；工具定义与协议见 `docs/CHAT_TOOLS.md`。SSE 端点 `POST /api/llm/chat/stream`。
- 工具调用审计落 `ai_records`，`op='chat_tool_use'`。
- `op` 白名单在 `store.py` 维护，扩 op 要同步改白名单。

## 测试

`tests/conftest.py` 提供 `client`（FastAPI TestClient）/ 临时 DuckDB / 临时 data 目录 fixtures。新增路由测试直接 `def test_xxx(client): ...`。
