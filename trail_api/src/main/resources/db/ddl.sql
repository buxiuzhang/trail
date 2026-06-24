-- Trail v2 schema · SQLite 版（M8）
-- 启动期由 SqliteDb.ensureSchema() 顺序执行；所有 DDL 走 IF NOT EXISTS，不破坏现有数据
--
-- 与 DuckDB 版的差异：
--   1) 4 序列 → INTEGER PRIMARY KEY AUTOINCREMENT（llm_settings 不需要）
--   2) VARCHAR[] → TEXT 存 JSON 字符串
--   3) BOOLEAN → INTEGER（0/1）
--   4) TIMESTAMP/DATE → TEXT（SQLite 没原生时间类型）

-- 1) 5 张表
CREATE TABLE IF NOT EXISTS tasks (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    title               TEXT    NOT NULL,
    alias               TEXT,
    description         TEXT,
    start_date          TEXT,                       -- DATE → TEXT
    processing_date     TEXT,
    end_date            TEXT,
    status              TEXT    NOT NULL,
    nature              TEXT    NOT NULL,
    summary             TEXT,
    maintenance_summary TEXT,
    tags                TEXT    NOT NULL DEFAULT '[]',   -- VARCHAR[] → JSON 字符串
    original_title      TEXT,
    source              TEXT    NOT NULL DEFAULT '任务需求.md',
    pinned_at           TEXT,                           -- TIMESTAMP → TEXT
    watched_at          TEXT,                           -- 特别关注标记时间
    created_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contact_channels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL,
    kind        TEXT    NOT NULL,
    channel     TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    target      TEXT,
    note        TEXT,
    created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id           INTEGER NOT NULL,
    log_date          TEXT    NOT NULL,                -- DATE → TEXT
    phase             TEXT    NOT NULL DEFAULT 'main',
    ordinal           INTEGER NOT NULL DEFAULT 0,
    content           TEXT    NOT NULL,
    polished_content  TEXT,
    hours             REAL    NOT NULL DEFAULT 1.0,    -- 工时（小时），0 < hours < 12
    is_deleted        INTEGER NOT NULL DEFAULT 0,      -- BOOLEAN → INTEGER
    deleted_at        TEXT,
    updated_at        TEXT,
    edit_count        INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         INTEGER,
    log_id          INTEGER,
    op              TEXT    NOT NULL,
    prompt          TEXT,
    response        TEXT,
    user_confirmed  INTEGER NOT NULL DEFAULT 0,        -- BOOLEAN → INTEGER
    created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS llm_settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

-- 6) 任务待办（M9：详情页 header 下方区块）
CREATE TABLE IF NOT EXISTS todos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         INTEGER NOT NULL,
    title           TEXT    NOT NULL,
    description     TEXT,
    is_completed    INTEGER NOT NULL DEFAULT 0,      -- BOOLEAN → INTEGER
    is_abandoned    INTEGER NOT NULL DEFAULT 0,      -- BOOLEAN → INTEGER（与 is_completed 互斥终态）
    created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7) 附件（M10：描述位截图粘贴）
--    "松散资源"：不被任何 description / content / log 字段外键引用；markdown 文本里
--    直接写 ![alt](/api/attachments/N) 即可。附件实体只管"存在哪、mime 是啥"。
--    rel_path 相对 <dataDir>/attachments/，年月分层便于后续 GC。
CREATE TABLE IF NOT EXISTS attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    rel_path      TEXT    NOT NULL,                                       -- 例 "2026/06/<uuid>.png"
    mime          TEXT    NOT NULL,                                       -- 例 "image/png"
    byte_size     INTEGER NOT NULL,
    sha256        TEXT    NOT NULL,                                       -- 去重键
    original_name TEXT,                                                   -- 用户原始文件名（可空）
    display_size  INTEGER NOT NULL DEFAULT 100,                           -- 展示宽度百分比 1-100（编辑时改这个调缩放）
    created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2) 7 个索引
CREATE INDEX IF NOT EXISTS idx_contact_channels_task  ON contact_channels(task_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_task         ON work_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_date         ON work_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status           ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_nature           ON tasks(nature);
CREATE INDEX IF NOT EXISTS idx_tasks_alias            ON tasks(alias);
CREATE INDEX IF NOT EXISTS idx_tasks_pinned           ON tasks(pinned_at);
CREATE INDEX IF NOT EXISTS idx_todos_task           ON todos(task_id);
CREATE INDEX IF NOT EXISTS idx_todos_completed      ON todos(is_completed);
CREATE INDEX IF NOT EXISTS idx_todos_abandoned      ON todos(is_abandoned);
CREATE INDEX IF NOT EXISTS idx_todos_status_created ON todos(is_abandoned, is_completed, created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_sha256  ON attachments(sha256);

-- 8) 通用日志引用表（替代 log_todo_refs，支持 todo / task / file 三种引用类型）
CREATE TABLE IF NOT EXISTS log_refs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id     INTEGER NOT NULL,
    ref_type   TEXT    NOT NULL,   -- 'todo' | 'task' | 'file'
    ref_id     INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (log_id) REFERENCES work_logs(id) ON DELETE CASCADE,
    UNIQUE(log_id, ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_log_refs_log  ON log_refs(log_id);
CREATE INDEX IF NOT EXISTS idx_log_refs_type ON log_refs(ref_type, ref_id);

-- 通用实体引用表（替代 log_refs，统一管理 log/task/todo 的 todo/task/file 引用）
CREATE TABLE IF NOT EXISTS entity_refs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    src_type   TEXT NOT NULL,   -- 'log' | 'task' | 'todo'
    src_id     INTEGER NOT NULL,
    src_field  TEXT NOT NULL,   -- 'content' | 'description' | 'summary' | 'maintenance_summary'
    ref_type   TEXT NOT NULL,   -- 'todo' | 'task' | 'file'
    ref_id     INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(src_type, src_id, src_field, ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_refs_src ON entity_refs(src_type, src_id);
CREATE INDEX IF NOT EXISTS idx_entity_refs_ref ON entity_refs(ref_type, ref_id);

-- 列表页最常用过滤+排序组合（status/nature 过滤 + start_date 排序）
CREATE INDEX IF NOT EXISTS idx_tasks_status_nature_date ON tasks(status, nature, start_date DESC);

-- FTS5 全文索引（content= 模式：不重复存储，主表是权威数据源）
CREATE VIRTUAL TABLE IF NOT EXISTS fts_tasks USING fts5(
    title,
    description,
    content='tasks',
    content_rowid='id',
    tokenize='trigram'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_logs USING fts5(
    content,
    polished_content,
    content='work_logs',
    content_rowid='id',
    tokenize='trigram'
);

-- 注意：fts_tasks / fts_logs 的 6 个同步触发器（INSERT/UPDATE/DELETE）
-- 在 SqliteDb.ensureSchema() 中以 Statement.execute() 直接创建，
-- 原因：触发器体含多条 SQL（BEGIN...END），ddl.sql 的分号分割逻辑会截断，无法在此定义。

-- MCP Servers（支持 stdio 本地进程 和 SSE 远程服务两种类型）
CREATE TABLE IF NOT EXISTS mcp_servers (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL,           -- 'stdio' | 'sse'
    command     TEXT,                       -- stdio: 可执行文件，如 "npx"
    args        TEXT,                       -- stdio: JSON 数组，如 ["@modelcontextprotocol/server-filesystem","/tmp"]
    env         TEXT,                       -- stdio: JSON 对象，额外环境变量
    url         TEXT,                       -- sse: 端点 URL
    headers     TEXT,                       -- sse: JSON 对象，额外请求头
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Skills（prompt 片段，聊天时合并进 chat_system_prompt）
CREATE TABLE IF NOT EXISTS skills (
    id              TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL,
    description     TEXT,
    system_prompt   TEXT    NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    scope           TEXT    NOT NULL DEFAULT '["chat"]',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);
CREATE INDEX IF NOT EXISTS idx_skills_enabled_order ON skills(enabled, sort_order);

-- 3) 1 个视图
--    DuckDB 版用 CURRENT_DATE - log_date → SQLite 用 julianday('now') - julianday(log_date)
CREATE VIEW IF NOT EXISTS v_stale_tasks AS
SELECT
    t.id, t.title, t.status, t.nature,
    (SELECT MAX(log_date) FROM work_logs w WHERE w.task_id = t.id AND w.is_deleted = 0) AS last_log_date,
    CAST(julianday(date('now','localtime')) - julianday((SELECT MAX(log_date) FROM work_logs w WHERE w.task_id = t.id AND w.is_deleted = 0)) AS INTEGER) AS days_idle
FROM tasks t
WHERE t.status = '进行中';
