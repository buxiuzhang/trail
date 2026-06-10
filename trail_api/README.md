# trail-api · Trail v2 Java 后端

Java 17 + Spring Boot 3.2 + Maven 3.x 重写。与 `../trail_app/`（Python 端）1:1 API/数据兼容。前端 `../trail_web/` 零修改可切换数据源。

阶段 1 已完成：18 端点（不含 LLM 调用）。
阶段 2/3 待实施：LLM 同步端点 / chat stream + tool use。

## 启动

```bash
# 0. 预迁移（仅一次：Fernet → 明文备份）
cd ..
python trail_api/scripts/dump_llm_settings.py
# → 产出 data/llm_settings.plain.yaml（5 项明文）

# 1. 编译
cd trail_api
mvn clean package -DskipTests

# 2. 启动（先停 Python 后端避免 DuckDB 写锁冲突）
java -jar target/trail-api.jar
# 启动期会：ensureSchema → 序列 setval → PlainYamlImporter 一次性 AES-GCM 重加密
# 完成后 data/llm_settings.plain.yaml 自动重命名为 .plain.yaml.done
```

## 端点（18）

| 资源 | 端点 |
|---|---|
| health | `GET /api/health` |
| tasks | `GET/POST /api/tasks` / `GET/PUT/DELETE /api/tasks/{id}` / `POST /api/tasks/{id}/{status,cancel,pin,unpin}` |
| logs | `GET/POST /api/tasks/{id}/logs` / `PUT/DELETE /api/tasks/{id}/logs/{lid}` |
| insights | `GET /api/insights/overview` / `GET /api/insights/stale` |
| settings | `GET/PUT /api/settings/{llm,motto,db}` |

## 数据

复用 `../data/tasks.duckdb`（6.5MB，9 任务 / 30 日志 / 24 渠道 / 53 ai_records / 5 llm_settings）。**禁止重建/迁库/改名**。
