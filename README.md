# Trail v2

任务填报 + 大模型辅助的 Web 工具。

## 功能

- **任务管理**：创建、编辑、删除任务，支持状态流转（未开始 → 进行中 → 已完成 / 已作废）
- **工作日志**：记录每日工作内容，支持润色、总结
- **大模型辅助**：润色日志、生成总结、聊天助手（需配置 LLM API Key）
- **数据导出**：导出日报、周报模板

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Java 17 + Spring Boot 3.2 + SQLite |
| 前端 | React 19 + TypeScript + Vite |
| 加密 | RSA-2048（传输）+ AES-GCM（存储） |

## 快速开始

### 环境要求

- Java 17+
- Node.js 18+ + pnpm

### 启动后端

```bash
cd trail_api
mvn clean package -DskipTests
java -jar target/trail-api.jar
```

后端启动在 http://localhost:8765

### 启动前端

```bash
cd trail_web
pnpm install
pnpm dev
```

前端启动在 http://localhost:5173

### 首次使用

1. 打开 http://localhost:5173
2. 首次访问会提示配置数据目录，确认后系统自动初始化
3. 在「设置 → 大模型」配置 LLM API Key（支持 Anthropic、OpenAI 兼容 API）

## 数据目录

所有数据存储在 `~/.trail/data/` 目录：

```
~/.trail/data/
├── db/
│   └── tasks.sqlite      # 主数据库
├── attachments/          # 附件
├── exports/              # 导出文件
├── logs/                 # 运行日志
├── trail_private.key     # RSA 私钥（加密传输用）
└── .secret_key           # AES 密钥（加密存储用）
```

## 安全

- **API Key 加密传输**：前端使用 RSA 公钥加密敏感数据，后端私钥解密
- **API Key 加密存储**：AES-GCM 加密后存入 SQLite
- **GET 响应遮蔽**：API Key 返回遮蔽值（如 `sk-****...****`）
- **密钥不入库**：私钥文件在 `~/.trail/data/`，git 忽略

详细架构见 [docs/CRYPTO_ARCHITECTURE.md](docs/CRYPTO_ARCHITECTURE.md)。

## 文档

- [需求说明](docs/REQUIREMENTS.md)
- [数据库结构](docs/SCHEMA.md)
- [加密架构](docs/CRYPTO_ARCHITECTURE.md)
- [聊天 Tool Use 协议](docs/CHAT_TOOLS.md)

## 开发

### 后端测试

```bash
cd trail_api
mvn test
```

### 前端测试

```bash
cd trail_web
pnpm build
```

## License

MIT