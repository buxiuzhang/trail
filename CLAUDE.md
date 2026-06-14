# CLAUDE.md

本文件供 Claude Code 读取。**所有对话、注释、文档用中文。**

项目中的执行计划统一保存到docs中。

## 项目

Trail v2 —— **任务填报 + 大模型辅助的 Web 工具**。

不做：GUI 悬浮窗 / 桌面机器人 / 主动推送通知（旧版已放弃）。
大模型只做**操作流内**辅助（润色日志 / 总结 / 询问维护阶段），不主动推送。

详细方向 `docs/REQUIREMENTS.md`、表结构 `docs/SCHEMA.md`、聊天 tool use 协议 `docs/CHAT_TOOLS.md`、加密架构 `docs/CRYPTO_ARCHITECTURE.md`。

## 技术栈

- **后端**：`trail_api/`——Java 17 + Spring Boot 3.2 + SQLite（JDBC，WAL 模式）
- **前端**：`trail_web/`——Vite + React 19 + TypeScript（独立 npm 包）
- **数据目录**：`~/.trail/data/`（`db/tasks.sqlite` + `attachments/` + `exports/` + `logs/`）
- **密钥文件**：`~/.trail/data/trail_private.key`（RSA 私钥）+ `.secret_key`（AES 密钥）

前端专属指令见 `trail_web/CLAUDE.md`。

## 启动 / 常用命令

```bash
# 使用启停脚本（推荐）
sh run.sh start          # 启动 API + Web
sh run.sh stop           # 停止全部
sh run.sh status         # 查看状态
sh run.sh start api      # 只启动后端
sh run.sh start web      # 只启动前端

# 手动启动后端
cd trail_api
mvn clean package -DskipTests   # 编译
java -jar target/trail-api.jar  # 启动（端口 8765）

# 手动启动前端（Vite dev，proxy /api → 8765）
cd trail_web && pnpm dev       # http://localhost:5173

# Electron 桌面应用（暂未实现）
cd trail-electron
npm run build                  # 构建主进程
npm run build:mac              # 打包 macOS .dmg
npm run build:win              # 打包 Windows .exe（需要在 Windows 或 CI 环境）

# 测试
mvn test -Dtest="AttachmentControllerTest"   # Java 端单项测试
mvn test                                       # Java 端全部测试
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
- **API key 加密存储**：AES-GCM 加密存入 SQLite，密钥在 `.secret_key`。
- **API key 加密传输**：前端用 RSA 公钥加密，后端用私钥解密。详见 `docs/CRYPTO_ARCHITECTURE.md`。
- **GET 响应遮蔽**：API Key 等敏感字段返回遮蔽值（如 `sk-****...****`）。

## LLM

Java 后端 LLM 端点已实现：

- 4 个同步函数：`polish` / `summarize_main` / `summarize_maintenance` / `ask_maintenance`
- 聊天走 Anthropic 协议原生 tool use 多轮循环
- SSE 端点 `POST /api/llm/chat/stream`
- 工具定义与协议见 `docs/CHAT_TOOLS.md`
- 工具调用审计落 `ai_records`，`op='chat_tool_use'`

## 后端架构

**SQLite 连接管理**（`SqliteDb`）：

- 单连接 + WAL 模式 + `synchronous=NORMAL`
- 写操作用 `ReentrantLock(true)` 串行化（公平锁）
- 未配置数据目录时 `conn=null`，所有查询抛 `DataDirNotConfiguredException` → HTTP 503

**分层架构**：

- `web/controller`：REST API 端点（Spring MVC）
- `service`：业务逻辑（如 `LlmService`）
- `store`：数据访问层（`TaskStore` / `LogStore` / `ContactStore` 等）
- `db`：SQLite 封装（`SqliteDb`）
- `crypto`：加密服务（RSA / AES-GCM）
- `llm`：LLM 集成（`OpenApiService` 提供 API 文档给 LLM 动态查询）

**OpenAPI 服务**（`OpenApiService`）：

- 从 `/v3/api-docs` 加载 API 文档
- 提供搜索接口给 LLM tool use（避免硬编码 API 列表）
- 禁止路径：`/api/llm/`、`/api/chat/`、`/api/settings/llm`（含 API Key）、`/api/attachments`、`/api/settings/data-dir`

## 测试

Java 测试在 `trail_api/src/test/`，使用 JUnit 5 + Spring Boot Test。
