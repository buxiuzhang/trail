package com.trail.db;

import com.trail.store.exception.DataDirNotConfiguredException;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Function;
import java.util.stream.Collectors;

import static com.trail.db.JdbcTypes.rowToMap;
import static com.trail.db.JdbcTypes.setParam;

/**
 * SQLite 单连接 + 写锁（M8 重写自原 DuckDb）。
 *
 * - 启动期 conn 可能为 null（未配置数据目录）；所有 query / update / runInTransaction
 *   入口检查 conn，未配置抛 DataDirNotConfiguredException → 503
 * - 写方法入口 writeLock.lock()；读方法不加锁（单连接已经串行）
 * - ensureSchema() 在启动期调一次（StartupChecks 调 openAndInitialize）
 */
@Component
public class SqliteDb {
    private static final Logger log = LoggerFactory.getLogger(SqliteDb.class);

    private final ReentrantLock writeLock = new ReentrantLock(true);
    private volatile Connection conn;
    private volatile Path currentDbFile;

    public SqliteDb() {}

    // ============================================================
    // 生命周期
    // ============================================================

    /** 打开新连接（数据目录切换或首次配置时）。开启 WAL + foreign_keys=OFF。 */
    public void openConnection(Path dataDir) {
        closeConnection();
        Path dbFile = dataDir.resolve("db/tasks.sqlite");
        try {
            Files.createDirectories(dbFile.getParent());
            String url = "jdbc:sqlite:" + dbFile.toAbsolutePath();
            this.conn = DriverManager.getConnection(url);
            this.currentDbFile = dbFile;
            try (Statement s = conn.createStatement()) {
                // WAL 模式（不支持时退化）
                try {
                    s.execute("PRAGMA journal_mode=WAL");
                } catch (Exception ex) {
                    log.warn("PRAGMA journal_mode=WAL 失败，退化: {}", ex.getMessage());
                }
                s.execute("PRAGMA synchronous=NORMAL");
                s.execute("PRAGMA cache_size=-64000");
                s.execute("PRAGMA temp_store=MEMORY");
                s.execute("PRAGMA mmap_size=268435456");
                s.execute("PRAGMA auto_vacuum=INCREMENTAL");
            }
            log.info("SQLite 打开: {}", dbFile);
        } catch (SQLException | java.io.IOException e) {
            throw new RuntimeException("打开 SQLite 失败 " + dbFile + ": " + e.getMessage(), e);
        }
    }

    public void closeConnection() {
        if (conn != null) {
            try {
                if (!conn.isClosed()) conn.close();
            } catch (SQLException ignored) {}
            conn = null;
        }
    }

    @PreDestroy
    public void shutdown() {
        closeConnection();
        log.info("SQLite 关闭");
    }

    public Path currentDbFile() { return currentDbFile; }

    // ============================================================
    // 三件套
    // ============================================================

    public List<Map<String, Object>> query(String sql, Object... params) {
        Connection c = requireConn();
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bindParams(ps, params);
            try (ResultSet rs = ps.executeQuery()) {
                List<Map<String, Object>> out = new ArrayList<>();
                while (rs.next()) out.add(rowToMap(rs));
                return out;
            }
        } catch (SQLException e) {
            throw new RuntimeException("查询失败: " + e.getMessage(), e);
        }
    }

    public int update(String sql, Object... params) {
        Connection c = requireConn();
        writeLock.lock();
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bindParams(ps, params);
            if (sql.toUpperCase().contains("RETURNING")) {
                try (ResultSet rs = ps.executeQuery()) {
                    int n = 0;
                    while (rs.next()) n++;
                    return n;
                }
            } else {
                return ps.executeUpdate();
            }
        } catch (SQLException e) {
            throw new RuntimeException("写入失败: " + e.getMessage(), e);
        } finally {
            writeLock.unlock();
        }
    }

    public Long insertReturningId(String sql, Object... params) {
        Connection c = requireConn();
        writeLock.lock();
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bindParams(ps, params);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) return ((Number) rs.getObject(1)).longValue();
                return null;
            }
        } catch (SQLException e) {
            throw new RuntimeException("INSERT 失败: " + e.getMessage(), e);
        } finally {
            writeLock.unlock();
        }
    }

    public <T> T runInTransaction(Function<Connection, T> body) {
        Connection c = requireConn();
        writeLock.lock();
        boolean prevAutoCommit = true;
        try {
            prevAutoCommit = c.getAutoCommit();
            c.setAutoCommit(false);
            T result;
            try {
                result = body.apply(c);
                c.commit();
                return result;
            } catch (RuntimeException e) {
                c.rollback();
                throw e;
            }
        } catch (SQLException e) {
            throw new RuntimeException("事务失败: " + e.getMessage(), e);
        } finally {
            try { c.setAutoCommit(prevAutoCommit); } catch (SQLException ignored) {}
            writeLock.unlock();
        }
    }

    private Connection requireConn() {
        if (conn == null) throw new DataDirNotConfiguredException();
        return conn;
    }

    // ============================================================
    // Schema 管理
    // ============================================================

    public void ensureSchema() {
        Connection c = requireConn();
        try {
            String ddl = readClasspath("db/ddl.sql");
            for (String stmt : splitSql(ddl)) {
                String t = stmt.trim();
                if (t.isEmpty()) continue;
                try (Statement s = c.createStatement()) {
                    s.execute(t);
                } catch (SQLException ex) {
                    // CREATE VIRTUAL TABLE IF NOT EXISTS 在表已存在时 sqlite-jdbc 有时抛此异常，可忽略
                    if (!ex.getMessage().contains("already exists") &&
                        !ex.getMessage().contains("finalized")) {
                        throw ex;
                    }
                }
            }
            // M10+: 已有 attachments 表补 display_size 列(IF NOT EXISTS 不支持 ALTER,这里容错)
            if (tableExists("attachments") && !columnExists("attachments", "display_size")) {
                try (Statement s = c.createStatement()) {
                    s.execute("ALTER TABLE attachments ADD COLUMN display_size INTEGER NOT NULL DEFAULT 100");
                    log.info("M10 迁移: attachments.display_size 列已添加");
                }
            }
            // M11: work_logs 表补 hours 列
            if (tableExists("work_logs") && !columnExists("work_logs", "hours")) {
                try (Statement s = c.createStatement()) {
                    s.execute("ALTER TABLE work_logs ADD COLUMN hours REAL NOT NULL DEFAULT 1.0");
                    log.info("M11 迁移: work_logs.hours 列已添加");
                }
            }
            // M13: tasks 表补 watched_at 列
            if (tableExists("tasks") && !columnExists("tasks", "watched_at")) {
                try (Statement s = c.createStatement()) {
                    s.execute("ALTER TABLE tasks ADD COLUMN watched_at TEXT");
                    log.info("M13 迁移: tasks.watched_at 列已添加");
                }
            }
            // M15: FTS5 tokenizer 升级 unicode61 → trigram（支持中文子串搜索）
            if (tableExists("fts_tasks")) {
                boolean isTrigram = false;
                try (Statement s = c.createStatement();
                     ResultSet rs = s.executeQuery(
                         "SELECT sql FROM sqlite_master WHERE type='table' AND name='fts_tasks'")) {
                    if (rs.next()) {
                        String sql = rs.getString(1);
                        isTrigram = sql != null && sql.contains("trigram");
                    }
                }
                if (!isTrigram) {
                    try (Statement s = c.createStatement()) {
                        s.execute("DROP TRIGGER IF EXISTS fts_tasks_ai");
                        s.execute("DROP TRIGGER IF EXISTS fts_tasks_ad");
                        s.execute("DROP TRIGGER IF EXISTS fts_tasks_au");
                        s.execute("DROP TRIGGER IF EXISTS fts_logs_ai");
                        s.execute("DROP TRIGGER IF EXISTS fts_logs_ad");
                        s.execute("DROP TRIGGER IF EXISTS fts_logs_au");
                        s.execute("DROP TABLE IF EXISTS fts_tasks");
                        s.execute("DROP TABLE IF EXISTS fts_logs");
                        s.execute("CREATE VIRTUAL TABLE fts_tasks USING fts5(title, description, content='tasks', content_rowid='id', tokenize='trigram')");
                        s.execute("CREATE VIRTUAL TABLE fts_logs USING fts5(content, polished_content, content='work_logs', content_rowid='id', tokenize='trigram')");
                        s.execute("INSERT INTO fts_tasks(rowid, title, description) SELECT id, title, description FROM tasks");
                        s.execute("INSERT INTO fts_logs(rowid, content, polished_content) SELECT id, content, polished_content FROM work_logs WHERE is_deleted = 0");
                    }
                    log.info("M15 迁移: FTS5 tokenizer 升级为 trigram，索引已重建");
                }
            }
            // FTS5 同步触发器（含 BEGIN...END，不走 splitSql 以免被 ; 切断）
            try (Statement s = c.createStatement()) {
                s.execute("CREATE TRIGGER IF NOT EXISTS fts_tasks_ai AFTER INSERT ON tasks BEGIN INSERT INTO fts_tasks(rowid, title, description) VALUES (new.id, new.title, new.description); END");
                s.execute("CREATE TRIGGER IF NOT EXISTS fts_tasks_ad AFTER DELETE ON tasks BEGIN INSERT INTO fts_tasks(fts_tasks, rowid, title, description) VALUES ('delete', old.id, old.title, old.description); END");
                s.execute("CREATE TRIGGER IF NOT EXISTS fts_tasks_au AFTER UPDATE ON tasks BEGIN INSERT INTO fts_tasks(fts_tasks, rowid, title, description) VALUES ('delete', old.id, old.title, old.description); INSERT INTO fts_tasks(rowid, title, description) VALUES (new.id, new.title, new.description); END");
                s.execute("CREATE TRIGGER IF NOT EXISTS fts_logs_ai AFTER INSERT ON work_logs BEGIN INSERT INTO fts_logs(rowid, content, polished_content) VALUES (new.id, new.content, new.polished_content); END");
                s.execute("CREATE TRIGGER IF NOT EXISTS fts_logs_ad AFTER DELETE ON work_logs BEGIN INSERT INTO fts_logs(fts_logs, rowid, content, polished_content) VALUES ('delete', old.id, old.content, old.polished_content); END");
                s.execute("CREATE TRIGGER IF NOT EXISTS fts_logs_au AFTER UPDATE ON work_logs BEGIN INSERT INTO fts_logs(fts_logs, rowid, content, polished_content) VALUES ('delete', old.id, old.content, old.polished_content); INSERT INTO fts_logs(rowid, content, polished_content) VALUES (new.id, new.content, new.polished_content); END");
            }
            // M14: FTS5 全文索引回填（虚拟表首次创建后，历史数据一次性导入）
            if (tableExists("fts_tasks")) {
                List<Map<String, Object>> ftsCount = query("SELECT COUNT(*) AS n FROM fts_tasks");
                List<Map<String, Object>> taskCount = query("SELECT COUNT(*) AS n FROM tasks");
                long ftsRows  = ftsCount.isEmpty()  ? 0 : ((Number) ftsCount.get(0).get("n")).longValue();
                long taskRows = taskCount.isEmpty() ? 0 : ((Number) taskCount.get(0).get("n")).longValue();
                if (ftsRows == 0 && taskRows > 0) {
                    try (Statement s = c.createStatement()) {
                        s.execute("INSERT INTO fts_tasks(rowid, title, description) SELECT id, title, description FROM tasks");
                        s.execute("INSERT INTO fts_logs(rowid, content, polished_content) SELECT id, content, polished_content FROM work_logs WHERE is_deleted = 0");
                    }
                    log.info("M14 迁移: FTS5 索引回填完成（tasks={}, 触发 work_logs 同步）", taskRows);
                }
            }
            // Skills scope 字段迁移
            if (tableExists("skills") && !columnExists("skills", "scope")) {
                try (Statement s = c.createStatement()) {
                    s.execute("ALTER TABLE skills ADD COLUMN scope TEXT NOT NULL DEFAULT '[\"chat\"]'");
                    log.info("skills.scope 列已添加");
                }
            }
            log.info("ensureSchema 完成");
        } catch (Exception e) {
            throw new RuntimeException("ensureSchema 失败: " + e.getMessage(), e);
        }
    }

    /**
     * M16: ai_records 存量 TEXT 数据压缩迁移。
     * typeof(prompt) = 'text' 表示未压缩，逐行读出 → GZIP 压缩 → 写回。
     */
    public void compressAiRecords() {
        List<Map<String, Object>> rows = query(
            "SELECT id, prompt, response FROM ai_records WHERE typeof(prompt) = 'text' OR typeof(response) = 'text'");
        if (rows.isEmpty()) return;
        writeLock.lock();
        try {
            conn.setAutoCommit(false);
            try (PreparedStatement ps = conn.prepareStatement(
                    "UPDATE ai_records SET prompt = ?, response = ? WHERE id = ?")) {
                for (Map<String, Object> row : rows) {
                    Object rawPrompt   = row.get("prompt");
                    Object rawResponse = row.get("response");
                    byte[] p = rawPrompt   instanceof String s ? com.trail.store.AiRecordStore.compress(s) : (byte[]) rawPrompt;
                    byte[] r = rawResponse instanceof String s ? com.trail.store.AiRecordStore.compress(s) : (byte[]) rawResponse;
                    ps.setBytes(1, p);
                    ps.setBytes(2, r);
                    ps.setLong(3, ((Number) row.get("id")).longValue());
                    ps.addBatch();
                }
                ps.executeBatch();
                conn.commit();
            } catch (Exception e) {
                conn.rollback();
                throw e;
            } finally {
                conn.setAutoCommit(true);
            }
            log.info("M16 迁移: ai_records 存量数据压缩完成，共 {} 条", rows.size());
        } catch (Exception e) {
            throw new RuntimeException("M16 压缩迁移失败: " + e.getMessage(), e);
        } finally {
            writeLock.unlock();
        }
    }

    /** 删除 retentionDays 天前的 ai_records。 */
    public int pruneAiRecords(int retentionDays) {
        int deleted = update(
            "DELETE FROM ai_records WHERE created_at < datetime('now', ? || ' days')",
            "-" + retentionDays);
        if (deleted > 0) log.info("pruneAiRecords: 已清理 {} 条超过 {} 天的 ai_records", deleted, retentionDays);
        return deleted;
    }



    public boolean tableExists(String table) {
        List<Map<String, Object>> rows = query(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", table);
        return !rows.isEmpty();
    }

    public boolean columnExists(String table, String column) {
        return columnType(table, column) != null;
    }

    public String columnType(String table, String column) {
        List<Map<String, Object>> rows = query(
            "SELECT type FROM pragma_table_info(?) WHERE name=?", table, column);
        return rows.isEmpty() ? null : (String) rows.get(0).get("type");
    }

    // ============================================================
    // 工具
    // ============================================================

    private void bindParams(PreparedStatement ps, Object[] params) throws SQLException {
        for (int i = 0; i < params.length; i++) {
            setParam(ps, i + 1, params[i]);
        }
    }

    private String readClasspath(String path) throws Exception {
        try (var is = new ClassPathResource(path).getInputStream();
             var br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            return br.lines().collect(Collectors.joining("\n"));
        }
    }

    private List<String> splitSql(String script) {
        List<String> out = new ArrayList<>();
        for (String s : script.split(";")) {
            String t = s.trim();
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }
}
