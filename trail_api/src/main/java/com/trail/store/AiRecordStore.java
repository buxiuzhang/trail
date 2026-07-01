package com.trail.store;

import com.trail.db.SqliteDb;
import com.trail.store.exception.StoreError;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/** ai_records append-only 写入，prompt/response 以 GZIP 压缩存储。 */
@Component
public class AiRecordStore {

    public static final Set<String> OPS = Set.of("polish", "summarize", "ask_maintenance", "chat", "chat_tool_use", "batch_parse", "batch_tag", "polish_dialog", "prompt_optimize");

    private final SqliteDb db;

    public AiRecordStore(SqliteDb db) {
        this.db = db;
    }

    public long addRecord(Long taskId, Long logId, String op, String prompt, String response, boolean userConfirmed) {
        if (op == null || !OPS.contains(op)) throw new StoreError("非法 op：" + op);
        Long id = db.insertReturningId(
            "INSERT INTO ai_records (task_id, log_id, op, prompt, response, user_confirmed)"
          + " VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
            taskId, logId, op, compress(prompt), compress(response), userConfirmed ? 1 : 0);
        if (id == null) throw new StoreError("ai_record 写入失败");
        return id;
    }

    public void confirmRecord(long recordId) {
        db.update("UPDATE ai_records SET user_confirmed = 1 WHERE id = ?", recordId);
    }

    /** 查询时自动解压 prompt/response 字段。 */
    public List<Map<String, Object>> listRecords(Long taskId) {
        List<Map<String, Object>> rows = db.query(
            "SELECT * FROM ai_records WHERE task_id = ? ORDER BY created_at DESC", taskId);
        rows.forEach(AiRecordStore::decompressRow);
        return rows;
    }

    // ── 压缩工具 ──────────────────────────────────────────────────

    /** 压缩字符串为 GZIP byte[]，null 返回 null。 */
    public static byte[] compress(String text) {
        if (text == null) return null;
        try (ByteArrayOutputStream bos = new ByteArrayOutputStream();
             GZIPOutputStream gz = new GZIPOutputStream(bos)) {
            gz.write(text.getBytes(StandardCharsets.UTF_8));
            gz.finish();
            return bos.toByteArray();
        } catch (IOException e) {
            throw new StoreError("GZIP 压缩失败: " + e.getMessage());
        }
    }

    /**
     * 解压 GZIP byte[] 为字符串。
     * 兼容存量 TEXT 数据：若不是 GZIP magic bytes 开头，直接当 UTF-8 字符串返回。
     */
    public static String decompress(Object raw) {
        if (raw == null) return null;
        if (raw instanceof byte[] bytes) {
            if (bytes.length >= 2 && bytes[0] == (byte) 0x1F && bytes[1] == (byte) 0x8B) {
                try (GZIPInputStream gz = new GZIPInputStream(new ByteArrayInputStream(bytes));
                     ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                    gz.transferTo(bos);
                    return bos.toString(StandardCharsets.UTF_8);
                } catch (IOException e) {
                    throw new StoreError("GZIP 解压失败: " + e.getMessage());
                }
            }
            return new String(bytes, StandardCharsets.UTF_8);
        }
        // 存量 TEXT 行：直接是 String
        return raw.toString();
    }

    /** 将 Map 中的 prompt/response 字段原地解压。 */
    public static void decompressRow(Map<String, Object> row) {
        if (row.containsKey("prompt"))   row.put("prompt",   decompress(row.get("prompt")));
        if (row.containsKey("response")) row.put("response", decompress(row.get("response")));
    }
}
