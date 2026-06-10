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
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 附件存储（M10：描述位截图粘贴）。
 *
 * 数据流：
 *   1) save(file)  → 校验 mime/大小 → SHA-256 → 去重 → 写盘 <dataDir>/attachments/YYYY/MM/<uuid>.<ext>
 *                  → INSERT attachments → 返 {id, url, mime, byteSize, originalName}
 *   2) load(id)    → SELECT rel_path, mime → 返给 controller 流式返回
 *
 * 安全：
 *   - mime 白名单（仅 image/* 四种）
 *   - 单图 10MB（与 application.yml spring.servlet.multipart.max-file-size 对齐）
 *   - 去重键：sha256；同图再粘只返旧 id
 *   - rel_path 由 store 决定，外部只通过 id 访问
 *   - 二次防穿越：load 出来再 normalize，必须仍以 <dataDir>/attachments/ 开头
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
                "SELECT id, mime, byte_size, original_name FROM attachments WHERE sha256 = ?", sha);
        if (!existing.isEmpty()) {
            Map<String, Object> r = existing.get(0);
            long existingId = ((Number) r.get("id")).longValue();
            return new Saved(
                    existingId,
                    urlOf(existingId),
                    (String) r.get("mime"),
                    ((Number) r.get("byte_size")).longValue(),
                    (String) r.get("original_name")
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
        // 二次校验：必须在 <dataDir>/attachments/ 下
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
            INSERT INTO attachments (rel_path, mime, byte_size, sha256, original_name)
            VALUES (?, ?, ?, ?, ?)
            RETURNING id
            """, relPath, mime, size, sha, originalName);
        if (newId == null) {
            // 写盘成功但落库失败 → 回滚文件
            try { Files.deleteIfExists(absFile); } catch (IOException ignored) {}
            throw new StoreError("写 attachment 记录失败");
        }
        return new Saved(newId, urlOf(newId), mime, size, originalName);
    }

    /** 读出文件位置 + mime，给 controller 流式返。 */
    public Loaded load(long id) {
        List<Map<String, Object>> rows = db.query(
                "SELECT rel_path, mime FROM attachments WHERE id = ?", id);
        if (rows.isEmpty()) throw new NotFoundException("附件不存在：" + id);
        Map<String, Object> r = rows.get(0);
        String relPath = (String) r.get("rel_path");
        String mime = (String) r.get("mime");

        Path dataDirPath = dataDir.currentDataDir();
        if (dataDirPath == null) {
            throw new StoreError("数据目录未配置");
        }
        Path attachRoot = dataDirPath.resolve("attachments").toAbsolutePath().normalize();
        Path abs = attachRoot.resolve(relPath).toAbsolutePath().normalize();
        if (!abs.startsWith(attachRoot)) {
            // rel_path 来自 DB，理论上安全；这里是兜底
            throw new StoreError("路径越界");
        }
        if (!Files.isRegularFile(abs)) {
            throw new NotFoundException("附件文件已丢失：id=" + id);
        }
        return new Loaded(abs, mime);
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
    public record Saved(long id, String url, String mime, long byteSize, String originalName) {}
    /** load() 返回的内部 record */
    public record Loaded(Path absolutePath, String mime) {}
}
