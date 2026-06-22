package com.trail.store;

import com.trail.db.SqliteDb;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 通用实体引用表（entity_refs）。
 *
 * 统一管理 log / task / todo 三种来源对 todo / task / file 的引用。
 * 替代 log_refs，并扩展到 tasks.description/summary/maintenance_summary
 * 和 todos.description。
 *
 * src_type: 'log' | 'task' | 'todo'
 * src_field: 'content' | 'description' | 'summary' | 'maintenance_summary'
 * ref_type:  'todo'    | 'task'         | 'file'
 */
@Component
public class EntityRefStore {

    private final SqliteDb db;

    public EntityRefStore(SqliteDb db) {
        this.db = db;
    }

    // ============================================================
    // 核心 CRUD
    // ============================================================

    /** 替换某来源某字段的某类引用（先删后插）。 */
    public void replaceRefs(String srcType, long srcId, String srcField,
                            String refType, List<Long> ids) {
        db.update("DELETE FROM entity_refs WHERE src_type=? AND src_id=? AND src_field=? AND ref_type=?",
            srcType, srcId, srcField, refType);
        if (ids == null || ids.isEmpty()) return;
        for (Long id : ids) {
            db.update("INSERT OR IGNORE INTO entity_refs (src_type,src_id,src_field,ref_type,ref_id) VALUES (?,?,?,?,?)",
                srcType, srcId, srcField, refType, id);
        }
    }

    /** 获取某来源某字段的某类引用 ID 列表。 */
    public List<Long> getRefs(String srcType, long srcId, String srcField, String refType) {
        List<Map<String, Object>> rows = db.query(
            "SELECT ref_id FROM entity_refs WHERE src_type=? AND src_id=? AND src_field=? AND ref_type=? ORDER BY id",
            srcType, srcId, srcField, refType);
        List<Long> ids = new ArrayList<>();
        for (Map<String, Object> row : rows) ids.add(((Number) row.get("ref_id")).longValue());
        return ids;
    }

    /** 批量获取多个来源的某类引用，避免 N+1。 */
    public Map<Long, List<Long>> getRefsForSources(String srcType, List<Long> srcIds,
                                                    String srcField, String refType) {
        if (srcIds == null || srcIds.isEmpty()) return Collections.emptyMap();
        String ph = srcIds.stream().map(id -> "?").collect(Collectors.joining(","));
        List<Object> params = new ArrayList<>(srcIds);
        params.add(srcType); params.add(srcField); params.add(refType);
        List<Map<String, Object>> rows = db.query(
            "SELECT src_id, ref_id FROM entity_refs WHERE src_id IN (" + ph + ")" +
            " AND src_type=? AND src_field=? AND ref_type=? ORDER BY src_id, id",
            params.toArray());
        Map<Long, List<Long>> result = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            long srcId = ((Number) row.get("src_id")).longValue();
            long refId = ((Number) row.get("ref_id")).longValue();
            result.computeIfAbsent(srcId, k -> new ArrayList<>()).add(refId);
        }
        return result;
    }

    /** 反向查询：哪些来源（某 src_type + src_field）引用了指定 ref。 */
    public List<Long> getSourceIdsForRef(String srcType, String srcField,
                                          String refType, long refId) {
        List<Map<String, Object>> rows = db.query(
            "SELECT src_id FROM entity_refs WHERE src_type=? AND src_field=? AND ref_type=? AND ref_id=? ORDER BY id",
            srcType, srcField, refType, refId);
        List<Long> ids = new ArrayList<>();
        for (Map<String, Object> row : rows) ids.add(((Number) row.get("src_id")).longValue());
        return ids;
    }

    /** 删除某实体的所有引用记录（实体删除时调用）。 */
    public void removeAll(String srcType, long srcId) {
        db.update("DELETE FROM entity_refs WHERE src_type=? AND src_id=?", srcType, srcId);
    }

    // ============================================================
    // 解析工具
    // ============================================================

    private static final Map<String, Pattern> TYPE_PATTERNS = Map.of(
        "todo", Pattern.compile("@todo:(\\d+)"),
        "task", Pattern.compile("@task:(\\d+)"),
        "file", Pattern.compile("@file:(\\d+)")
    );

    /** 从文本中提取 @type:ID 引用 ID 列表（去重、保序）。 */
    public List<Long> parseIds(String content, String refType) {
        if (content == null || content.isBlank()) return Collections.emptyList();
        Pattern p = TYPE_PATTERNS.get(refType);
        if (p == null) return Collections.emptyList();
        Matcher m = p.matcher(content);
        List<Long> ids = new ArrayList<>();
        java.util.LinkedHashSet<Long> seen = new java.util.LinkedHashSet<>();
        while (m.find()) {
            long id = Long.parseLong(m.group(1));
            if (seen.add(id)) ids.add(id);
        }
        return ids;
    }

    /** 同步某实体某字段的全部引用类型（todo/task/file）。 */
    public void syncAllRefs(String srcType, long srcId, String srcField, String content) {
        for (String refType : List.of("todo", "task", "file")) {
            replaceRefs(srcType, srcId, srcField, refType, parseIds(content, refType));
        }
    }

    // ============================================================
    // 启动迁移（幂等，由 StartupChecks 在 ensureSchema 之后调用）
    // ============================================================

    public void migrate() {
        migrateFromLogRefs();
        migrateWorkLogContents();
        migrateTaskFields();
        migrateTodoDescriptions();
    }

    /** log_refs → entity_refs，然后 DROP log_refs。 */
    private void migrateFromLogRefs() {
        List<Map<String, Object>> exists = db.query(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='log_refs'");
        if (exists.isEmpty()) return;
        db.update("""
            INSERT OR IGNORE INTO entity_refs (src_type, src_id, src_field, ref_type, ref_id, created_at)
            SELECT 'log', log_id, 'content', ref_type, ref_id, created_at FROM log_refs
            """);
        db.update("DROP TABLE log_refs");
    }

    /**
     * work_logs.content 里旧 Markdown 附件格式 → @file:N，并同步 entity_refs。
     * 幂等：content 已含 @file: 且已有 entity_refs 记录则跳过。
     */
    private void migrateWorkLogContents() {
        List<Map<String, Object>> logs = db.query(
            "SELECT id, content FROM work_logs WHERE content LIKE '%/api/attachments/%'");
        for (Map<String, Object> row : logs) {
            long logId  = ((Number) row.get("id")).longValue();
            String content = (String) row.get("content");
            if (content == null) continue;
            String updated = convertMarkdownToTokens(content);
            if (!updated.equals(content)) {
                db.update("UPDATE work_logs SET content = ? WHERE id = ?", updated, logId);
            }
            // 补写可能缺失的 file 引用（幂等，INSERT OR IGNORE）
            for (Long fileId : parseIds(updated, "file")) {
                db.update("INSERT OR IGNORE INTO entity_refs (src_type,src_id,src_field,ref_type,ref_id) VALUES ('log',?,'content','file',?)",
                    logId, fileId);
            }
        }
    }

    /**
     * tasks 的 description / summary / maintenance_summary 字段迁移：
     * 旧 Markdown 格式 → @file:N，并写入 entity_refs。
     */
    private void migrateTaskFields() {
        List<Map<String, Object>> tasks = db.query(
            "SELECT id, description, summary, maintenance_summary FROM tasks");
        for (Map<String, Object> row : tasks) {
            long taskId = ((Number) row.get("id")).longValue();
            migrateTextField("task", taskId, "description",   (String) row.get("description"));
            migrateTextField("task", taskId, "summary",       (String) row.get("summary"));
            migrateTextField("task", taskId, "maintenance_summary", (String) row.get("maintenance_summary"));
        }
    }

    /** todos.description 字段迁移。 */
    private void migrateTodoDescriptions() {
        List<Map<String, Object>> todos = db.query("SELECT id, description FROM todos");
        for (Map<String, Object> row : todos) {
            long todoId = ((Number) row.get("id")).longValue();
            migrateTextField("todo", todoId, "description", (String) row.get("description"));
        }
    }

    /**
     * 迁移单个文本字段：
     * 1. 旧 Markdown 附件格式 → @file:N
     * 2. 解析所有引用写入 entity_refs
     * 幂等：已有 entity_refs 记录则跳过文本替换（但仍补写缺失引用）。
     */
    private void migrateTextField(String srcType, long srcId, String srcField, String text) {
        if (text == null || text.isBlank()) return;

        String updated = convertMarkdownToTokens(text);
        if (!updated.equals(text)) {
            // 更新文本字段
            db.update("UPDATE " + tableFor(srcType) + " SET " + srcField + " = ? WHERE id = ?",
                updated, srcId);
        }
        // 写入 entity_refs（幂等）
        syncAllRefs(srcType, srcId, srcField, updated);
    }

    private static String tableFor(String srcType) {
        return switch (srcType) {
            case "log"  -> "work_logs";
            case "task" -> "tasks";
            case "todo" -> "todos";
            default -> throw new IllegalArgumentException("未知 srcType: " + srcType);
        };
    }

    /** 将旧 Markdown 附件格式转换为 @file:N token。 */
    static String convertMarkdownToTokens(String text) {
        if (text == null) return null;
        // 正常图片: ![alt](url)
        text = Pattern.compile("!\\[[^\\]]*]\\(/api/attachments/(\\d+)\\)")
            .matcher(text).replaceAll(mr -> "@file:" + mr.group(1));
        // 正常文件链接: [name](url)（排除图片）
        text = Pattern.compile("(?<!!)\\[[^\\]]*]\\(/api/attachments/(\\d+)\\)")
            .matcher(text).replaceAll(mr -> "@file:" + mr.group(1));
        // 损坏格式: ![name(/api/attachments/N)
        text = Pattern.compile("!\\[[^\\](]*\\(/api/attachments/(\\d+)\\)")
            .matcher(text).replaceAll(mr -> "@file:" + mr.group(1));
        return text;
    }
}
