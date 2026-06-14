# trail-api · Trail v2 Java 后端

Trail v2 的 Java 后端服务，提供任务管理、工作日志、大模型集成等 REST API。

## 技术栈

- **Java 17** + **Spring Boot 3.2**
- **SQLite**（JDBC，WAL 模式）
- **Maven 3.x** 构建
- **AES-GCM** 加密存储敏感数据
- **RSA-2048** 加密传输 API Key

## 快速启动

### 使用项目启停脚本（推荐）

```bash
cd ..
sh run.sh start          # 启动 API + Web
sh run.sh stop           # 停止全部
sh run.sh status         # 查看状态
```

### 手动启动

```bash
# 编译
cd trail_api
mvn clean package -DskipTests

# 启动（端口 8765）
java -jar target/trail-api.jar
```

## 数据目录

所有数据存储在 `~/.trail/data/`：

```
~/.trail/data/
├── db/
│   └── tasks.sqlite      # 主数据库（SQLite WAL 模式）
├── attachments/          # 附件
├── exports/              # 导出文件
├── logs/                 # 运行日志
├── trail_private.key     # RSA 私钥（加密传输用）
└── .secret_key           # AES 密钥（加密存储用）
```

首次启动时系统会自动：
1. 创建数据目录结构
2. 生成 RSA/AES 密钥
3. 初始化数据库 schema
4. 写入默认配置

## API 端点

### 核心端点

| 资源 | 端点 | 说明 |
|------|------|------|
| health | `GET /api/health` | 健康检查 |
| tasks | `GET/POST /api/tasks` | 任务列表/创建 |
| tasks | `GET/PUT/DELETE /api/tasks/{id}` | 任务详情/更新/删除 |
| tasks | `POST /api/tasks/{id}/status` | 状态变更（完成/作废） |
| tasks | `POST /api/tasks/{id}/cancel` | 作废任务 |
| tasks | `POST /api/tasks/{id}/pin` | 置顶 |
| tasks | `POST /api/tasks/{id}/unpin` | 取消置顶 |
| logs | `GET/POST /api/tasks/{id}/logs` | 日志列表/创建 |
| logs | `PUT/DELETE /api/tasks/{id}/logs/{lid}` | 日志更新/软删 |
| todos | `GET/POST /api/tasks/{id}/todos` | 待办列表/创建 |
| todos | `POST /api/tasks/{id}/todos/{tid}/complete` | 待办完成 |
| todos | `POST /api/tasks/{id}/todos/{tid}/abandon` | 待办废弃 |
| todos | `DELETE /api/tasks/{id}/todos/{tid}` | 待办删除 |
| insights | `GET /api/insights/overview` | 统计概览 |
| insights | `GET /api/insights/stale` | 僵尸任务 |

### LLM 端点

| 端点 | 说明 |
|------|------|
| `POST /api/llm/polish` | 润色日志 |
| `POST /api/tasks/{id}/summarize` | 主体阶段总结 |
| `POST /api/tasks/{id}/maintenance/summarize` | 维护期总结 |
| `POST /api/tasks/{id}/maintenance/ask` | 维护建议 |
| `POST /api/llm/chat/stream` | 聊天（SSE + Tool Use） |

### 设置端点

| 端点 | 说明 |
|------|------|
| `GET/PUT /api/settings/llm` | LLM 配置（API Key、模型、认证方式等） |
| `GET/PUT /api/settings/motto` | 卷首语 |
| `GET/PUT /api/settings/data-dir` | 数据目录 |
| `GET/PUT /api/settings/placeholders` | 占位提示语 |
| `GET /api/rsa/public-key` | RSA 公钥（用于加密 API Key） |

## LLM 配置

### 支持的 API 提供商

Trail 支持任意 Anthropic 兼容的 API，包括：

- **智谱（ZhiPu/GLM）**：`https://api.sfkey.cn`、`https://open.bigmodel.cn`
- **DeepSeek**：`https://api.deepseek.com`
- **MiniMax**：`https://api.minimaxi.com/anthropic`
- **Anthropic 官方**：`https://api.anthropic.com`
- **其他 OpenAI-Compatible API**

### 认证方式配置

Trail 支持两种认证方式（**前端下拉框选择，无需改代码**）：

| 认证方式 | HTTP Header | 适用场景 |
|----------|-------------|----------|
| **Bearer** | `Authorization: Bearer <key>` | 智谱、DeepSeek、MiniMax、OpenRouter 等 |
| **x-api-key** | `x-api-key: <key>` | Anthropic 官方 API |

### 配置示例

在设置页面（http://localhost:5173/settings）：

- **Base URL**：`https://api.sfkey.cn`
- **认证方式**：选择 `Bearer`
- **模型**：`glm-5`
- **Max Tokens**：`1000`

### Tool Use 协议

聊天接口实现 Anthropic 原生 tool use 多轮循环：

1. LLM 输出 tool_use 请求
2. 后端执行工具（查询任务/日志/API 文档）
3. 返回 tool_result
4. LLM 继续处理（最多 10 轮）

工具定义见 `docs/CHAT_TOOLS.md`。

## 加密架构

### API Key 加密流程

1. **前端加密传输**：RSA-2048 公钥加密
2. **后端解密**：RSA 私钥解密
3. **存储加密**：AES-GCM 加密存入 SQLite
4. **GET 响应遮蔽**：返回 `sk-****...****`

详见 `docs/CRYPTO_ARCHITECTURE.md`。

## 测试

```bash
# 运行全部测试
mvn test

# 运行单个测试
mvn test -Dtest="AttachmentControllerTest"
```

## 开发说明

### SQLite 写锁

SQLite 使用单连接 + WAL 模式，写操作用 `ReentrantLock(true)` 串行化。

未配置数据目录时返回 HTTP 503。

### OpenAPI 服务

`OpenApiService` 从 `/v3/api-docs` 加载 API 文档，提供给 LLM tool use 动态查询。

禁止路径：
- `/api/llm/`、`/api/chat/`（避免递归）
- `/api/settings/llm`（含 API Key）
- `/api/attachments`、`/api/settings/data-dir`

### 日志配置

运行日志位于 `~/.trail/logs/api.log`。

日志级别配置见 `application.yml`：

```yaml
logging:
  level:
    root: INFO
    com.trail: INFO
```

## 文档

- [需求说明](../docs/REQUIREMENTS.md)
- [数据库结构](../docs/SCHEMA.md)
- [加密架构](../docs/CRYPTO_ARCHITECTURE.md)
- [聊天 Tool Use 协议](../docs/CHAT_TOOLS.md)

## License

MIT