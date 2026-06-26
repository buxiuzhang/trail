package com.trail.store;

import com.trail.config.AppProperties;
import com.trail.config.DataDirService;
import com.trail.db.SqliteDb;
import com.trail.store.exception.NotFoundException;
import com.trail.store.exception.StoreError;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 附件存储（M10：描述位截图粘贴 + M11：缩放/引用追踪/删除）。
 *
 * 配置从 application.yml 读取：trail.attachment.max-bytes
 */
@Component
public class AttachmentStore {

    private static final Set<String> ALLOWED_MIMES = Set.of(
            // 图片
            "image/png", "image/jpeg", "image/gif", "image/webp",
            // PDF
            "application/pdf",
            // Word
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            // Excel
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            // PowerPoint
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            // 文本
            "text/plain",
            "text/csv",
            // 压缩包
            "application/zip",
            "application/x-rar-compressed",
            "application/x-7z-compressed"
    );
    private static final long DEFAULT_MAX_BYTES = 50L * 1024 * 1024; // 50MB
    private static final Map<String, String> EXT_BY_MIME = Map.ofEntries(
            Map.entry("image/png", ".png"),
            Map.entry("image/jpeg", ".jpg"),
            Map.entry("image/gif", ".gif"),
            Map.entry("image/webp", ".webp"),
            Map.entry("application/pdf", ".pdf"),
            Map.entry("application/msword", ".doc"),
            Map.entry("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
            Map.entry("application/vnd.ms-excel", ".xls"),
            Map.entry("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"),
            Map.entry("application/vnd.ms-powerpoint", ".ppt"),
            Map.entry("application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"),
            Map.entry("text/plain", ".txt"),
            Map.entry("text/csv", ".csv"),
            Map.entry("application/zip", ".zip"),
            Map.entry("application/x-rar-compressed", ".rar"),
            Map.entry("application/x-7z-compressed", ".7z")
    );
    private static final int DEFAULT_DISPLAY_SIZE = 100;
    private static final String KEY_ALLOWED_MIMES = "attachment_allowed_mimes";
    private static final String KEY_MAX_BYTES = "attachment_max_bytes";

    private final SqliteDb db;
    private final DataDirService dataDir;
    private final AppProperties props;
    private final EntityRefStore entityRefStore;
    private final LLMSettingsStore settingsStore;

    public AttachmentStore(SqliteDb db, DataDirService dataDir, AppProperties props,
                           EntityRefStore entityRefStore, LLMSettingsStore settingsStore) {
        this.db = db;
        this.dataDir = dataDir;
        this.props = props;
        this.entityRefStore = entityRefStore;
        this.settingsStore = settingsStore;
    }

    /** 获取当前生效的 MIME 白名单（DB 优先，否则默认全集） */
    public Set<String> getAllowedMimes() {
        String raw = settingsStore.get(KEY_ALLOWED_MIMES);
        if (raw == null || raw.isBlank()) return ALLOWED_MIMES;
        Set<String> result = new java.util.HashSet<>();
        for (String m : raw.split(",")) {
            String trimmed = m.strip().toLowerCase();
            if (!trimmed.isEmpty()) result.add(trimmed);
        }
        return result.isEmpty() ? ALLOWED_MIMES : result;
    }

    /** 获取当前生效的最大文件大小（DB 优先，否则 AppProperties，否则 50MB） */
    public long getMaxBytesEffective() {
        String raw = settingsStore.get(KEY_MAX_BYTES);
        if (raw != null && !raw.isBlank()) {
            try { return Long.parseLong(raw.strip()); } catch (NumberFormatException ignored) {}
        }
        return getMaxBytes();
    }

    /** 获取配置的最大文件大小 */
    private long getMaxBytes() {
        return props != null && props.attachment() != null
            ? props.attachment().getMaxBytes() : DEFAULT_MAX_BYTES;
    }

    /** 上传一个图片。返回响应 DTO 字段。 */
    public Saved save(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new StoreError("文件为空");
        }
        String mime = file.getContentType();
        if (mime == null) mime = "";
        mime = mime.toLowerCase().trim();
        if (!getAllowedMimes().contains(mime)) {
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                    "不支持的文件类型：" + mime);
        }
        long size = file.getSize();
        long maxBytes = getMaxBytesEffective();
        if (size > maxBytes) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
                    "单图上限 " + (maxBytes / 1024 / 1024) + "MB，当前 " + size + " 字节");
        }

        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new StoreError("读上传文件失败：" + e.getMessage());
        }

        String sha = sha256Hex(bytes);

        // 去重：同 sha 已有 → 直接返旧 id
        List<Map<String, Object>> existing = db.query(
                "SELECT id, mime, byte_size, original_name, display_size FROM attachments WHERE sha256 = ?", sha);
        if (!existing.isEmpty()) {
            Map<String, Object> r = existing.get(0);
            long existingId = ((Number) r.get("id")).longValue();
            return new Saved(
                    existingId,
                    urlOf(existingId),
                    (String) r.get("mime"),
                    ((Number) r.get("byte_size")).longValue(),
                    (String) r.get("original_name"),
                    ((Number) r.get("display_size")).intValue()
            );
        }

        // 写盘
        Path dataDirPath = dataDir.currentDataDir();
        if (dataDirPath == null) {
            throw new StoreError("数据目录未配置");
        }
        LocalDate today = LocalDate.now();
        String yyyy = String.format("%04d", today.getYear());
        String mm = String.format("%02d", today.getMonthValue());
        String ext = EXT_BY_MIME.getOrDefault(mime, "");
        String name = UUID.randomUUID().toString().replace("-", "") + ext;
        String relPath = yyyy + "/" + mm + "/" + name;

        Path absDir = dataDirPath.resolve("attachments").resolve(yyyy).resolve(mm).toAbsolutePath().normalize();
        Path absFile = absDir.resolve(name).toAbsolutePath().normalize();
        Path attachRoot = dataDirPath.resolve("attachments").toAbsolutePath().normalize();
        if (!absFile.startsWith(attachRoot)) {
            throw new StoreError("路径越界");
        }
        try {
            Files.createDirectories(absDir);
            Files.write(absFile, bytes);
        } catch (IOException e) {
            throw new StoreError("写盘失败：" + e.getMessage());
        }

        String originalName = file.getOriginalFilename();
        if (originalName == null || originalName.isBlank()) {
            originalName = null;
        } else {
            originalName = originalName.strip();
        }

        Long newId = db.insertReturningId("""
            INSERT INTO attachments (rel_path, mime, byte_size, sha256, original_name, display_size)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id
            """, relPath, mime, size, sha, originalName, DEFAULT_DISPLAY_SIZE);
        if (newId == null) {
            try { Files.deleteIfExists(absFile); } catch (IOException ignored) {}
            throw new StoreError("写 attachment 记录失败");
        }
        return new Saved(newId, urlOf(newId), mime, size, originalName, DEFAULT_DISPLAY_SIZE);
    }

    /** 读出文件位置 + mime，给 controller 流式返。 */
    public Loaded load(long id) {
        Row r = mustRow(id);
        Path dataDirPath = dataDir.currentDataDir();
        if (dataDirPath == null) {
            throw new StoreError("数据目录未配置");
        }
        Path attachRoot = dataDirPath.resolve("attachments").toAbsolutePath().normalize();
        Path abs = attachRoot.resolve(r.relPath()).toAbsolutePath().normalize();
        if (!abs.startsWith(attachRoot)) {
            throw new StoreError("路径越界");
        }
        if (!Files.isRegularFile(abs)) {
            throw new NotFoundException("附件文件已丢失：id=" + id);
        }
        return new Loaded(abs, r.mime());
    }

    /** 读一条 attachment 行（不删）。用于 PUT/GET references 场景。 */
    public Row get(long id) {
        return mustRow(id);
    }

    /**
     * 查找引用了此附件的所有位置（log / task / todo）。
     * 全部走 entity_refs 表，不再 LIKE 扫描。
     */
    public List<Reference> findReferences(long id) {
        List<Reference> out = new ArrayList<>();

        // work_logs
        List<Map<String, Object>> logRows = db.query("""
            SELECT w.id, w.task_id, w.log_date, w.is_deleted
            FROM entity_refs r
            JOIN work_logs w ON w.id = r.src_id
            WHERE r.src_type='log' AND r.src_field='content'
              AND r.ref_type='file' AND r.ref_id=? AND w.is_deleted=0
            """, id);
        for (Map<String, Object> r : logRows) {
            out.add(new Reference("log", ((Number) r.get("id")).longValue(), "content",
                ((Number) r.get("task_id")).longValue(), null,
                r.get("log_date") == null ? null : r.get("log_date").toString(), null, false));
        }

        // tasks
        List<Map<String, Object>> taskRows = db.query("""
            SELECT r.src_id, r.src_field, t.title
            FROM entity_refs r JOIN tasks t ON t.id = r.src_id
            WHERE r.src_type='task' AND r.ref_type='file' AND r.ref_id=?
            """, id);
        for (Map<String, Object> r : taskRows) {
            long taskId = ((Number) r.get("src_id")).longValue();
            out.add(new Reference("task", taskId, (String) r.get("src_field"),
                taskId, (String) r.get("title"), null, null, false));
        }

        // todos
        List<Map<String, Object>> todoRows = db.query("""
            SELECT r.src_id, td.task_id, td.title
            FROM entity_refs r JOIN todos td ON td.id = r.src_id
            WHERE r.src_type='todo' AND r.src_field='description' AND r.ref_type='file' AND r.ref_id=?
            """, id);
        for (Map<String, Object> r : todoRows) {
            out.add(new Reference("todo", ((Number) r.get("src_id")).longValue(), "description",
                ((Number) r.get("task_id")).longValue(), (String) r.get("title"), null, null, false));
        }

        return out;
    }

    /** 缩放更新。size 范围 1-100 由 controller 校验。 */
    public Row updateSize(long id, int size) {
        mustRow(id);  // 404 if not exists
        db.update("UPDATE attachments SET display_size = ? WHERE id = ?", size, id);
        return mustRow(id);
    }

    /** 更新文件名。content 里用 @file:N 存储，名称从 DB 读取，无需同步 content。 */
    public Row updateName(long id, String name) {
        mustRow(id);
        db.update("UPDATE attachments SET original_name = ? WHERE id = ?", name, id);
        return mustRow(id);
    }

    /** + DB 行，引用检查由 controller 负责。
     */
    public void delete(long id) {
        Row r = mustRow(id);

        // 清理所有引用该附件的文本字段中的 @file:N token
        String token = "@file:" + id;
        List<Map<String, Object>> refs = db.query(
            "SELECT src_type, src_id, src_field FROM entity_refs WHERE ref_type='file' AND ref_id=?", id);
        for (Map<String, Object> ref : refs) {
            String srcType  = (String) ref.get("src_type");
            long   srcId    = ((Number) ref.get("src_id")).longValue();
            String srcField = (String) ref.get("src_field");
            String table    = switch (srcType) {
                case "log"  -> "work_logs";
                case "task" -> "tasks";
                case "todo" -> "todos";
                default     -> null;
            };
            if (table == null) continue;
            String col = "log".equals(srcType) ? "content" : srcField;
            List<Map<String, Object>> rows2 = db.query(
                "SELECT " + col + " AS txt FROM " + table + " WHERE id=?", srcId);
            if (rows2.isEmpty()) continue;
            String txt = (String) rows2.get(0).get("txt");
            if (txt == null) continue;
            String updated = txt.replaceAll(java.util.regex.Pattern.quote(token) + "(?!\\d)", "")
                .replaceAll("\n{3,}", "\n\n").strip();
            if (!updated.equals(txt)) {
                db.update("UPDATE " + table + " SET " + col + "=? WHERE id=?", updated, srcId);
            }
        }
        // 清理 entity_refs
        db.update("DELETE FROM entity_refs WHERE ref_type='file' AND ref_id=?", id);

        Path dataDirPath = dataDir.currentDataDir();
        if (dataDirPath != null) {
            Path attachRoot = dataDirPath.resolve("attachments").toAbsolutePath().normalize();
            Path abs = attachRoot.resolve(r.relPath()).toAbsolutePath().normalize();
            if (abs.startsWith(attachRoot)) {
                try { Files.deleteIfExists(abs); } catch (IOException ignored) {}
            }
        }
        db.update("DELETE FROM attachments WHERE id = ?", id);
    }

    // ============================================================
    // 内部
    // ============================================================

    private Row mustRow(long id) {
        List<Map<String, Object>> rows = db.query(
                "SELECT id, rel_path, mime, byte_size, original_name, display_size FROM attachments WHERE id = ?", id);
        if (rows.isEmpty()) throw new NotFoundException("附件不存在：" + id);
        Map<String, Object> r = rows.get(0);
        return new Row(
                ((Number) r.get("id")).longValue(),
                (String) r.get("rel_path"),
                (String) r.get("mime"),
                ((Number) r.get("byte_size")).longValue(),
                (String) r.get("original_name"),
                ((Number) r.get("display_size")).intValue()
        );
    }

    /** 通用 LIKE 扫描，构造 Reference 列表。 */
    private List<Reference> scanColumn(String sourceType, String column,
                                       String sql, String pat, String taskIdAlias) {
        List<Map<String, Object>> rows = db.query(sql, pat);
        List<Reference> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            long sourceId = ((Number) r.get("id")).longValue();
            long taskId = taskIdAlias == null ? sourceId
                    : ((Number) r.get(taskIdAlias)).longValue();
            String title = r.get("title") == null ? null : (String) r.get("title");
            String logDate = r.get("log_date") == null ? null : (String) r.get("log_date");
            boolean deleted = r.get("is_deleted") != null && ((Number) r.get("is_deleted")).intValue() == 1;
            String col = (String) r.get("col");
            String snippet = snippetAround(col, "/api/attachments/", 20);
            out.add(new Reference(sourceType, sourceId, column, taskId, title, logDate, snippet, deleted));
        }
        return out;
    }

    private static String snippetAround(String text, String marker, int around) {
        if (text == null) return null;
        int i = text.indexOf(marker);
        if (i < 0) return null;
        int start = Math.max(0, i - around);
        int end = Math.min(text.length(), i + marker.length() + around);
        return (start > 0 ? "…" : "") + text.substring(start, end) + (end < text.length() ? "…" : "");
    }

    private static String urlOf(long id) {
        return "/api/attachments/" + id;
    }

    private static String sha256Hex(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(data));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }

    /** 返回所有有附件引用的任务（id + title），用于文件管理筛选下拉。 */
    public List<Map<String, Object>> listReferencedTasks() {
        return db.query("""
            SELECT DISTINCT t.id, t.title
            FROM entity_refs r
            JOIN tasks t ON t.id = (
                CASE r.src_type
                    WHEN 'task' THEN r.src_id
                    WHEN 'log'  THEN (SELECT task_id FROM work_logs WHERE id = r.src_id)
                    WHEN 'todo' THEN (SELECT task_id FROM todos WHERE id = r.src_id)
                END
            )
            WHERE r.ref_type = 'file'
            ORDER BY t.id DESC
            """);
    }

    /**
     * 附件列表查询（文件管理页）。
     * mimeTypes 为空 = 不过滤；taskIds 为空 = 不过滤。
     * taskId 筛选：找引用了该 task 的附件（扫 tasks/work_logs/todos 三张表）。
     */
    public List<ListItem> listAttachments(List<String> mimeTypes, List<Long> taskIds) {
        StringBuilder sql = new StringBuilder("""
            SELECT a.id, a.rel_path, a.mime, a.byte_size, a.original_name,
                   a.display_size, a.created_at,
                   (SELECT COUNT(*) FROM entity_refs WHERE ref_type='file' AND ref_id=a.id
                   ) AS ref_count,
                   (SELECT COUNT(*) FROM entity_refs r2
                     LEFT JOIN work_logs w2 ON r2.src_type='log' AND w2.id=r2.src_id
                     WHERE r2.ref_type='file' AND r2.ref_id=a.id
                       AND (r2.src_type != 'log' OR w2.is_deleted=0)
                   ) AS active_ref_count
            FROM attachments a
            WHERE 1=1
            """);
        List<Object> params = new ArrayList<>();

        if (mimeTypes != null && !mimeTypes.isEmpty()) {
            sql.append(" AND a.mime IN (")
               .append("?,".repeat(mimeTypes.size()).replaceAll(",$", ""))
               .append(")");
            params.addAll(mimeTypes);
        }

        if (taskIds != null && !taskIds.isEmpty()) {
            String ph = "?,".repeat(taskIds.size()).replaceAll(",$", "");
            sql.append("""
                 AND a.id IN (
                   SELECT ref_id FROM entity_refs r3
                   WHERE r3.ref_type='file'
                     AND (
                       (r3.src_type='task' AND r3.src_id IN (""" + ph + """
                       ))
                       OR (r3.src_type='log' AND r3.src_id IN (
                             SELECT id FROM work_logs WHERE task_id IN (""" + ph + """
                           )))
                       OR (r3.src_type='todo' AND r3.src_id IN (
                             SELECT id FROM todos WHERE task_id IN (""" + ph + """
                           )))
                     )
                 )
                """);
            params.addAll(taskIds);
            params.addAll(taskIds);
            params.addAll(taskIds);
        }

        sql.append("""
             ORDER BY
               CASE WHEN (SELECT MAX(t.created_at) FROM tasks t
                 WHERE t.id IN (
                   SELECT CASE src_type
                     WHEN 'task' THEN src_id
                     WHEN 'log'  THEN (SELECT task_id FROM work_logs WHERE id=src_id)
                     WHEN 'todo' THEN (SELECT task_id FROM todos WHERE id=src_id)
                   END FROM entity_refs WHERE ref_type='file' AND ref_id=a.id
                 )
               ) IS NULL THEN 1 ELSE 0 END,
               (SELECT MAX(t.created_at) FROM tasks t
                 WHERE t.id IN (
                   SELECT CASE src_type
                     WHEN 'task' THEN src_id
                     WHEN 'log'  THEN (SELECT task_id FROM work_logs WHERE id=src_id)
                     WHEN 'todo' THEN (SELECT task_id FROM todos WHERE id=src_id)
                   END FROM entity_refs WHERE ref_type='file' AND ref_id=a.id
                 )
               ) DESC,
               a.created_at DESC
            """);

        List<Map<String, Object>> rows = db.query(sql.toString(), params.toArray());
        List<ListItem> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            out.add(new ListItem(
                ((Number) r.get("id")).longValue(),
                (String) r.get("rel_path"),
                (String) r.get("mime"),
                ((Number) r.get("byte_size")).longValue(),
                (String) r.get("original_name"),
                ((Number) r.get("display_size")).intValue(),
                (String) r.get("created_at"),
                ((Number) r.get("ref_count")).intValue(),
                ((Number) r.get("active_ref_count")).intValue()
            ));
        }
        return out;
    }

    /** save() 返回的内部 record */
    public record Saved(long id, String url, String mime, long byteSize, String originalName, int displaySize) {}

    /** get/updateSize 返回的内部 record（含 display_size 完整字段） */
    public record Row(long id, String relPath, String mime, long byteSize, String originalName, int displaySize) {
        public String url() { return "/api/attachments/" + id; }
    }

    /** listAttachments 返回的内部 record */
    public record ListItem(long id, String relPath, String mime, long byteSize,
                           String originalName, int displaySize, String createdAt, int refCount, int activeRefCount) {
        public String url() { return "/api/attachments/" + id; }
    }

    /** load() 返回的内部 record */
    public record Loaded(Path absolutePath, String mime) {}

    /** findReferences 返的内部 record */
    public record Reference(String sourceType, long sourceId, String column,
                            long taskId, String title, String logDate, String snippet, boolean deleted) {}
}
