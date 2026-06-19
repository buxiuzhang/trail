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
            try (Statement s = c.createStatement()) {
                for (String stmt : splitSql(ddl)) {
                    String t = stmt.trim();
                    if (t.isEmpty()) continue;
                    s.execute(t);
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
            log.info("ensureSchema 完成");
        } catch (Exception e) {
            throw new RuntimeException("ensureSchema 失败: " + e.getMessage(), e);
        }
    }

    // ============================================================
    // 元数据查询（SQLite 用 sqlite_master / pragma table_info）
    // ============================================================

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
