package com.trail.web.controller;

import com.trail.store.AttachmentStore;
import com.trail.web.dto.AttachmentResponse;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

/**
 * 附件上传 / 下载 / 更新 / 引用追踪 / 删除（M10 + M11）。
 *
 * 端点：
 *   POST   /api/attachments            上传
 *   GET    /api/attachments/{id}       流式返图
 *   PUT    /api/attachments/{id}       更新 displaySize（范围 1-100）
 *   GET    /api/attachments/{id}/references  反查引用此图的 5 字段位置
 *   DELETE /api/attachments/{id}       删除（>0 引用返 409）
 */
@RestController
@RequestMapping("/api/attachments")
public class AttachmentController {

    private final AttachmentStore store;

    public AttachmentController(AttachmentStore store) {
        this.store = store;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public AttachmentResponse upload(@RequestParam("file") MultipartFile file) {
        return AttachmentResponse.from(store.save(file));
    }

    @GetMapping("/{id}")
    public ResponseEntity<FileSystemResource> serve(@PathVariable long id) {
        AttachmentStore.Loaded f = store.load(id);
        MediaType ct;
        try {
            ct = MediaType.parseMediaType(f.mime());
        } catch (Exception e) {
            ct = MediaType.APPLICATION_OCTET_STREAM;
        }
        return ResponseEntity.ok()
                .contentType(ct)
                .body(new FileSystemResource(f.absolutePath()));
    }

    /** 拿 attachment 元信息（JSON 形态）。与 GET /{id} 的二进制流分开。 */
    @GetMapping("/{id}/meta")
    public AttachmentResponse meta(@PathVariable long id) {
        return AttachmentResponse.from(store.get(id));
    }

    @PutMapping("/{id}")
    public AttachmentResponse update(@PathVariable long id, @RequestBody UpdateRequest body) {
        if (body == null || body.getDisplaySize() == null) {
            throw new IllegalArgumentException("displaySize 必填");
        }
        int size = body.getDisplaySize();
        if (size < 1 || size > 100) {
            throw new IllegalArgumentException("displaySize 必须在 1-100 之间");
        }
        return AttachmentResponse.from(store.updateSize(id, size));
    }

    @GetMapping("/{id}/references")
    public List<ReferenceDto> references(@PathVariable long id) {
        // 先确认 id 存在（不存在直接 404）
        store.get(id);
        return store.findReferences(id).stream().map(ReferenceDto::from).toList();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable long id) {
        List<AttachmentStore.Reference> refs = store.findReferences(id);
        if (!refs.isEmpty()) {
            List<ReferenceDto> dtos = refs.stream().map(ReferenceDto::from).toList();
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "error", "ATTACHMENT_IN_USE",
                    "refCount", refs.size(),
                    "references", dtos
            ));
        }
        store.delete(id);
        return ResponseEntity.noContent().build();
    }

    public static class UpdateRequest {
        // 入参字段名锁定 displaySize（绕开 JacksonConfig 的 SNAKE_CASE 全局策略，
        // 保证 PUT /api/attachments/{id} 的 body 字段名稳定）
        @com.fasterxml.jackson.annotation.JsonProperty("displaySize")
        private Integer displaySize;
        public Integer getDisplaySize() { return displaySize; }
        public void setDisplaySize(Integer displaySize) { this.displaySize = displaySize; }
    }

    public record ReferenceDto(
            String sourceType,
            long sourceId,
            String column,
            long taskId,
            String title,
            String logDate,
            String snippet
    ) {
        public static ReferenceDto from(AttachmentStore.Reference r) {
            return new ReferenceDto(r.sourceType(), r.sourceId(), r.column(),
                    r.taskId(), r.title(), r.logDate(), r.snippet());
        }
    }
}
