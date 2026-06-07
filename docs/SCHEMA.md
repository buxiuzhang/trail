# DuckDB 表结构（`data/tasks.duckdb`）

> 表结构**单一来源**在 `trail_app/db.py` 的 `_DDL` 常量里，本文档与之保持同步。

## `tasks`（任务主表）

| 列名 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT` PK | DB 自增（`nextval('tasks_id_seq')`），**永不变** |
| `title` | `VARCHAR` | 任务标题（拼写纠正后） |
| `alias` | `VARCHAR` | 任务内部简称 / 别名（沟通用，可空） |
| `description` | `VARCHAR` | 任务描述 |
| `start_date` | `DATE` | 任务开始时间（新建时默认今天） |
| `processing_date` | `DATE` | 任务处理时间 |
| `end_date` | `DATE` | 任务完成时间（进入已完成 / 维护中时填） |
| `status` | `VARCHAR` | 5 状态之一（见 `docs/REQUIREMENTS.md` §5） |
| `nature` | `VARCHAR` | `长期` / `临时` / `维护` |
| `summary` | `VARCHAR` | 主体总结（main phase，M3 大模型生成） |
| `maintenance_summary` | `VARCHAR` | 维护期总结（maintenance phase，M3） |
| `tags` | `VARCHAR[]` | 标签列表（来自 md 的「标签」行） |
| `original_title` | `VARCHAR` | 拼写纠正前的原标题（可空） |
| `source` | `VARCHAR` | 数据来源 md 文件名 |
| `pinned_at` | `TIMESTAMP` | 置顶时间（`NULL` = 未置顶；list 排序时 `DESC NULLS LAST` 优先） |
| `created_at` | `TIMESTAMP` | 导入时间（DB 默认） |
| `updated_at` | `TIMESTAMP` | 最近一次 UPDATE（DB 默认） |

## `contact_channels`（对接渠道子表，独立维度 kind × channel）

| 列名 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT` PK | DB 自增（`nextval('contact_channels_id_seq')`） |
| `task_id` | `BIGINT` FK→`tasks.id` | 所属任务 |
| `kind` | `VARCHAR` | 本质类型：`group` / `person` / `email` / `phone` / `other` |
| `channel` | `VARCHAR` | 具体平台：`dingtalk` / `wechat` / `elink` / `lark` / `feishu` / `email` / `phone` / `other` |
| `name` | `VARCHAR` | 群名 / 人名（必填） |
| `target` | `VARCHAR` | 群号 / 微信号 / 邮箱地址 / 电话（可空） |
| `note` | `VARCHAR` | 备注（可空） |
| `created_at` | `TIMESTAMP` | 写入时间 |

**删除策略**：删任务时手动级联删本表（`TaskStore.delete_task`，因 DuckDB FK 不支持 CASCADE）。

## `work_logs`（工作日志，可编辑、可软删）

| 列名 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT` PK | 自增 IDENTITY |
| `task_id` | `BIGINT` FK→`tasks.id` | 所属任务 |
| `log_date` | `DATE` | 工作日期（YYYY-MM-DD） |
| `phase` | `VARCHAR` | `main`（主体）/ `maintenance`（维护期） |
| `ordinal` | `INTEGER` | 同一日期内顺序 |
| `content` | `VARCHAR` | 原文 |
| `polished_content` | `VARCHAR` | 润色后版本（M3，可空） |
| `is_deleted` | `BOOLEAN` | 软删标志（列表默认 `FALSE` 过滤） |
| `deleted_at` | `TIMESTAMP` | 软删时间 |
| `updated_at` | `TIMESTAMP` | 最近一次编辑时间（`IS NULL` = 从未编辑） |
| `edit_count` | `INTEGER` | 编辑次数 |
| `created_at` | `TIMESTAMP` | 写入时间 |

## `ai_records`（大模型操作审计，M3 才用）

| 列名 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT` PK | 自增 IDENTITY |
| `task_id` | `BIGINT` | 所属任务（无 FK） |
| `log_id` | `BIGINT` | 关联 work_logs.id（润色时有，总结时为空） |
| `op` | `VARCHAR` | `polish` / `summarize` / `ask_maintenance` |
| `prompt` | `VARCHAR` | 发给 LLM 的 prompt（脱敏后） |
| `response` | `VARCHAR` | LLM 返回内容 |
| `user_confirmed` | `BOOLEAN` | 用户是否采纳 |
| `created_at` | `TIMESTAMP` | 时间 |

## 视图 `v_stale_tasks`

```sql
CREATE OR REPLACE VIEW v_stale_tasks AS
SELECT
    t.id, t.title, t.status, t.nature,
    (SELECT MAX(log_date) FROM work_logs w WHERE w.task_id = t.id) AS last_log_date,
    CURRENT_DATE - (SELECT MAX(log_date) FROM work_logs w WHERE w.task_id = t.id) AS days_idle
FROM tasks t
WHERE t.status IN ('进行中', '维护中');
```

## 索引

- `idx_contact_channels_task` — `contact_channels(task_id)`
- `idx_work_logs_task`         — `work_logs(task_id)`
- `idx_work_logs_date`         — `work_logs(log_date)`
- `idx_tasks_status`           — `tasks(status)`
- `idx_tasks_nature`           — `tasks(nature)`
- `idx_tasks_alias`            — `tasks(alias)`
- `idx_tasks_pinned`           — `tasks(pinned_at)`

## 行为约定

- 导入策略：按 `title` 跳过已存在任务（幂等）；`--recreate` 先 DROP 再 CREATE。
- 状态/性质的合法值不在 DB 层 CHECK，由 store 层兜底。
- 空日期字符串在 md 中落 `NULL`。
- **不使用 DuckDB FK 约束**（UPDATE 被引用的主表行会被拦截；应用层 manual cascade 维护完整性）。
- 删任务时由 `TaskStore.delete_task` 手动按子表 → 主表顺序删。
- md ↔ DB 字段映射：

  | md 字段 | DB 字段 |
  | --- | --- |
  | 任务描述 | `description` |
  | 任务别名 | `alias` |
  | 任务开始时间 | `start_date` |
  | 任务处理时间 | `processing_date` |
  | 任务完成时间 | `end_date` |
  | 任务完成状态 | `status` |
  | 任务性质 | `nature` |
  | 标签（逗号 / 顿号分隔） | `tags` |
  | 任务总结（代码块） | `summary` |
  | 处理情况（日期列） | `work_logs.log_date` |
  | 处理情况（情况列） | `work_logs.content` |
  | 任务对接 `- 群｜钉钉｜名称（target）／note` | `contact_channels` |
  | 任务标题（H2） | `tasks.title` |

- **任务对接** md 段格式（每行）：

  ```
  - {kind}｜{channel}｜{name}[（{target}）][／{note}]
  ```

  分隔符：半角 `|` 或全角 `｜` 都可。`name` 是必填段。`（target）` 抠中文 / 英文括号；`／` / `/` 后跟 note。
