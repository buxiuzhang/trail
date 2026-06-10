package com.trail.store;

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
 * 数据流：
 *   1) save(file)  → 校验 mime/大小 → SHA-256 → 去重 → 写盘 <dataDir>/attachments/YYYY/MM/<uuid>.<ext>
 *                  → INSERT attachments → 返 Saved{...}
 *   2) load(id)    → SELECT rel_path, mime → 返给 controller 流式返回
 *   3) findReferences(id) → 扫 5 字段 LIKE '%/api/attachments/N)%' 返 Reference 列表
 *   4) updateSize(id, size) → UPDATE display_size (1-100 校验在 controller)
 *   5) delete(id)  → 0 引用时删磁盘 + DB；>0 引用时返 false 让 controller 返 409
 *
 * 安全：
 *   - mime 白名单（仅 image/* 四种）
 *   - 单图 10MB（与 application.yml spring.servlet.multipart.max-file-size 对齐）
 *   - 去重键：sha256；同图再粘只返旧 id
 *   - rel_path 由 store 决定，外部只通过 id 访问
 *   - 二次防穿越：load/delete 出来再 normalize，必须仍以 <dataDir>/attachments/ 开头
 */
@Component
public class AttachmentStore {

    private static final Set<String> ALLOWED_MIMES = Set.of(
            "image/png", "image/jpeg", "image/gif", "image/webp"
    );
    private static final long MAX_BYTES = 10L * 1024 * 1024;
    private static final Map<String, String> EXT_BY_MIME = Map.of(
            "image/png", ".png",
            "image/jpeg", ".jpg",
            "image/gif", ".gif",
            "image/webp", ".webp"
    );
    private static final int DEFAULT_DISPLAY_SIZE = 100;

    private final SqliteDb db;
    private final DataDirService dataDir;

    public AttachmentStore(SqliteDb db, DataDirService dataDir) {
        this.db = db;
        this.dataDir = dataDir;
    }

    /** 上传一个图片。返回响应 DTO 字段。 */
    public Saved save(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new StoreError("文件为空");
        }
        String mime = file.getContentType();
        if (mime == null) mime = "";
        mime = mime.toLowerCase().trim();
        if (!ALLOWED_MIMES.contains(mime)) {
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                    "仅支持 png / jpeg / gif / webp，当前：" + mime);
        }
        long size = file.getSize();
        if (size > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
                    "单图上限 10MB，当前 " + size + " 字节");
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
        String ext = EXT_BY_MIME.get(mime);
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
     * 扫 5 个文本字段,找哪些位置引用了 attachment id。
     * LIKE pattern: "%/api/attachments/N)%"  末尾 ) 锚定避免 N=12 误命中 123
     * 5 字段：
     *   tasks.description / tasks.summary / tasks.maintenance_summary
     *   work_logs.content / work_logs.polished_content
     *   todos.description
     */
    public List<Reference> findReferences(long id) {
        String pat = "%/api/attachments/" + id + ")%";
        List<Reference> out = new ArrayList<>();

        // tasks 三个字段
        out.addAll(scanColumn("task", "description",
                "SELECT id, title, description AS col FROM tasks WHERE description LIKE ?", pat, "id"));
        out.addAll(scanColumn("task", "summary",
                "SELECT id, title, summary AS col FROM tasks WHERE summary LIKE ?", pat, "id"));
        out.addAll(scanColumn("task", "maintenance_summary",
                "SELECT id, title, maintenance_summary AS col FROM tasks WHERE maintenance_summary LIKE ?", pat, "id"));

        // work_logs 两个字段
        out.addAll(scanColumn("log", "content",
                "SELECT id, task_id, log_date, content AS col FROM work_logs WHERE content LIKE ?", pat, "task_id"));
        out.addAll(scanColumn("log", "polished_content",
                "SELECT id, task_id, log_date, polished_content AS col FROM work_logs WHERE polished_content LIKE ?", pat, "task_id"));

        // todos.description
        out.addAll(scanColumn("todo", "description",
                "SELECT id, task_id, title, description AS col FROM todos WHERE description LIKE ?", pat, "task_id"));

        return out;
    }

    /** 缩放更新。size 范围 1-100 由 controller 校验。 */
    public Row updateSize(long id, int size) {
        mustRow(id);  // 404 if not exists
        db.update("UPDATE attachments SET display_size = ? WHERE id = ?", size, id);
        return mustRow(id);
    }

    /**
     * 物理删除。0 引用→删磁盘 + DB 行；>0 引用→不删返 false（controller 转 409）。
     */
    public boolean delete(long id) {
        if (!findReferences(id).isEmpty()) {
            return false;
        }
        Row r = mustRow(id);
        Path dataDirPath = dataDir.currentDataDir();
        if (dataDirPath != null) {
            Path attachRoot = dataDirPath.resolve("attachments").toAbsolutePath().normalize();
            Path abs = attachRoot.resolve(r.relPath()).toAbsolutePath().normalize();
            if (abs.startsWith(attachRoot)) {
                try { Files.deleteIfExists(abs); } catch (IOException ignored) {}
            }
        }
        db.update("DELETE FROM attachments WHERE id = ?", id);
        return true;
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
            String col = (String) r.get("col");
            // 提一段 snippet：截 col 中匹配子串前后 20 字符
            String snippet = snippetAround(col, "/api/attachments/", 20);
            out.add(new Reference(sourceType, sourceId, column, taskId, title, logDate, snippet));
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

    /** save() 返回的内部 record */
    public record Saved(long id, String url, String mime, long byteSize, String originalName, int displaySize) {}

    /** get/updateSize 返回的内部 record（含 display_size 完整字段） */
    public record Row(long id, String relPath, String mime, long byteSize, String originalName, int displaySize) {
        public String url() { return "/api/attachments/" + id; }
    }

    /** load() 返回的内部 record */
    public record Loaded(Path absolutePath, String mime) {}

    /** findReferences 返的内部 record */
    public record Reference(String sourceType, long sourceId, String column,
                            long taskId, String title, String logDate, String snippet) {}
}
