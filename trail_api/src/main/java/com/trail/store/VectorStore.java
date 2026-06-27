package com.trail.store;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * 向量存储（SQLite 实现）。
 *
 * 用独立的 vectors/vectors.sqlite 存储 embedding 向量，
 * 查询时全量加载入内存做余弦相似度计算（线性扫描）。
 *
 * 数据量在个人工作记录场景（万级）内性能充裕：
 *   5000 条 × 1536 维 ≈ 5ms，5 万条 ≈ 50ms。
 */
@Component
public class VectorStore {

    private static final Logger log = LoggerFactory.getLogger(VectorStore.class);

    private volatile Connection conn;
    private volatile Path dbPath;
    private final ReentrantReadWriteLock rwLock = new ReentrantReadWriteLock();

    /** 由 StartupChecks / DataDirService 在数据目录就绪后调用 */
    public synchronized void open(Path dataDir) {
        close();
        try {
            Path vectorDir = dataDir.resolve("vectors");
            Files.createDirectories(vectorDir);
            dbPath = vectorDir.resolve("vectors.sqlite");
            conn = DriverManager.getConnection("jdbc:sqlite:" + dbPath);
            conn.setAutoCommit(true);
            ensureSchema();
            log.info("VectorStore 已开启: {} ({} 条)", dbPath, countRows());
        } catch (Exception e) {
            log.warn("VectorStore 初始化失败: {}", e.getMessage());
            conn = null;
        }
    }

    public synchronized void close() {
        if (conn != null) {
            try { conn.close(); } catch (Exception ignored) {}
            conn = null;
        }
    }

    @PreDestroy
    public void shutdown() {
        close();
    }

    /** 写入或更新一条向量记录（upsert by id）。 */
    public void upsert(String id, String source, String text, float[] vector) {
        requireOpen();
        rwLock.writeLock().lock();
        try {
            String sql = """
                INSERT INTO embeddings (id, source, text, created_at, vector)
                VALUES (?, ?, ?, date('now'), ?)
                ON CONFLICT(id) DO UPDATE SET
                    source = excluded.source,
                    text = excluded.text,
                    vector = excluded.vector
                """;
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, id);
                ps.setString(2, source);
                ps.setString(3, text);
                ps.setBytes(4, floatsToBytes(vector));
                ps.executeUpdate();
            }
        } catch (SQLException e) {
            throw new RuntimeException("向量写入失败: " + e.getMessage(), e);
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    /**
     * 余弦相似度搜索，返回 topK 条最相似记录。
     */
    public List<SearchResult> search(float[] query, int topK) {
        requireOpen();
        rwLock.readLock().lock();
        try {
            List<Row> rows = loadAll();
            float queryNorm = norm(query);
            if (queryNorm == 0f) return List.of();

            List<SearchResult> results = new ArrayList<>(rows.size());
            for (Row row : rows) {
                float score = cosine(query, queryNorm, row.vector());
                results.add(new SearchResult(row.id(), row.source(), row.text(), score));
            }
            results.sort((a, b) -> Float.compare(b.score(), a.score()));
            return results.subList(0, Math.min(topK, results.size()));
        } catch (SQLException e) {
            throw new RuntimeException("向量搜索失败: " + e.getMessage(), e);
        } finally {
            rwLock.readLock().unlock();
        }
    }

    /** 删除单条向量记录（id 不存在时静默成功）。 */
    public void delete(String id) {
        if (conn == null || id == null) return;
        rwLock.writeLock().lock();
        try (PreparedStatement ps = conn.prepareStatement("DELETE FROM embeddings WHERE id = ?")) {
            ps.setString(1, id);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.warn("向量删除失败 id={}: {}", id, e.getMessage());
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    public List<String> listIds() {
        if (conn == null) return List.of();
        rwLock.readLock().lock();
        try {
            List<String> ids = new ArrayList<>();
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery("SELECT id FROM embeddings ORDER BY rowid")) {
                while (rs.next()) ids.add(rs.getString(1));
            }
            return ids;
        } catch (SQLException e) {
            log.warn("listIds 失败: {}", e.getMessage());
            return List.of();
        } finally {
            rwLock.readLock().unlock();
        }
    }

    public long countRows() {
        if (conn == null) return 0;
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM embeddings")) {
            return rs.next() ? rs.getLong(1) : 0;
        } catch (SQLException e) {
            return 0;
        }
    }

    // ── records ────────────────────────────────────────────────────

    public record SearchResult(String id, String source, String text, float score) {}

    private record Row(String id, String source, String text, float[] vector) {}

    // ── helpers ────────────────────────────────────────────────────

    private void ensureSchema() throws SQLException {
        try (Statement st = conn.createStatement()) {
            st.execute("""
                CREATE TABLE IF NOT EXISTS embeddings (
                    id         TEXT PRIMARY KEY,
                    source     TEXT,
                    text       TEXT,
                    created_at TEXT,
                    vector     BLOB NOT NULL
                )
                """);
        }
    }

    private void requireOpen() {
        if (conn == null) throw new com.trail.store.exception.DataDirNotConfiguredException();
    }

    private List<Row> loadAll() throws SQLException {
        List<Row> rows = new ArrayList<>();
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT id, source, text, vector FROM embeddings")) {
            while (rs.next()) {
                rows.add(new Row(
                    rs.getString(1),
                    rs.getString(2),
                    rs.getString(3),
                    bytesToFloats(rs.getBytes(4))
                ));
            }
        }
        return rows;
    }

    private static float cosine(float[] a, float aNorm, float[] b) {
        if (a.length != b.length) return 0f;
        float dot = 0f;
        for (int i = 0; i < a.length; i++) dot += a[i] * b[i];
        float bNorm = norm(b);
        return bNorm == 0f ? 0f : dot / (aNorm * bNorm);
    }

    private static float norm(float[] v) {
        float s = 0f;
        for (float x : v) s += x * x;
        return (float) Math.sqrt(s);
    }

    private static byte[] floatsToBytes(float[] floats) {
        byte[] bytes = new byte[floats.length * 4];
        for (int i = 0; i < floats.length; i++) {
            int bits = Float.floatToIntBits(floats[i]);
            bytes[i * 4]     = (byte) (bits >> 24);
            bytes[i * 4 + 1] = (byte) (bits >> 16);
            bytes[i * 4 + 2] = (byte) (bits >> 8);
            bytes[i * 4 + 3] = (byte) bits;
        }
        return bytes;
    }

    private static float[] bytesToFloats(byte[] bytes) {
        if (bytes == null) return new float[0];
        float[] floats = new float[bytes.length / 4];
        for (int i = 0; i < floats.length; i++) {
            int bits = ((bytes[i * 4] & 0xFF) << 24)
                     | ((bytes[i * 4 + 1] & 0xFF) << 16)
                     | ((bytes[i * 4 + 2] & 0xFF) << 8)
                     |  (bytes[i * 4 + 3] & 0xFF);
            floats[i] = Float.intBitsToFloat(bits);
        }
        return floats;
    }
}
