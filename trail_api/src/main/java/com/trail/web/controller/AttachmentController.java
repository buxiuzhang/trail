package com.trail.web.controller;

import com.trail.store.AttachmentStore;
import com.trail.web.dto.AttachmentListItemResponse;
import com.trail.web.dto.AttachmentResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

/**
 * 附件上传 / 下载 / 更新 / 引用追踪 / 删除
 */
@RestController
@RequestMapping("/api/attachments")
@Tag(name = "附件管理", description = "图片等附件的上传、下载、更新、删除")
public class AttachmentController {

    private final AttachmentStore store;

    public AttachmentController(AttachmentStore store) {
        this.store = store;
    }

    @Operation(summary = "有附件的任务列表", description = "返回有附件引用的任务 id 和 title，用于筛选下拉")
    @GetMapping("/tasks")
    public List<Map<String, Object>> referencedTasks() {
        return store.listReferencedTasks();
    }

    @Operation(summary = "按 ID 批量获取附件元数据", description = "前端 @file:N decoration 按需获取名称和 MIME 类型")
    @GetMapping("/by-ids")
    public List<AttachmentResponse> byIds(@RequestParam List<Long> ids) {
        if (ids == null || ids.isEmpty()) return List.of();
        return ids.stream()
            .map(id -> {
                try { return AttachmentResponse.from(store.get(id)); }
                catch (Exception e) { return null; }
            })
            .filter(java.util.Objects::nonNull)
            .toList();
    }

    @Operation(summary = "附件列表", description = "查询所有附件，支持按 MIME 类型和任务 ID 筛选")
    @GetMapping
    public List<AttachmentListItemResponse> list(
            @RequestParam(required = false) List<String> mime,
            @RequestParam(required = false) List<Long> taskId) {
        return store.listAttachments(mime, taskId).stream()
                .map(AttachmentListItemResponse::from)
                .toList();
    }

    @Operation(summary = "上传附件", description = "上传图片等文件，返回附件 ID 和访问路径")
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public AttachmentResponse upload(@Parameter(description = "文件") @RequestParam("file") MultipartFile file) {
        return AttachmentResponse.from(store.save(file));
    }

    @Operation(summary = "下载附件", description = "图片内联显示，其他文件触发下载")
    @GetMapping("/{id}")
    public ResponseEntity<FileSystemResource> serve(@Parameter(description = "附件 ID") @PathVariable long id) {
        AttachmentStore.Loaded f = store.load(id);
        AttachmentStore.Row row = store.get(id);
        MediaType ct;
        try {
            ct = MediaType.parseMediaType(f.mime());
        } catch (Exception e) {
            ct = MediaType.APPLICATION_OCTET_STREAM;
        }
        var builder = ResponseEntity.ok().contentType(ct);
        if (!f.mime().startsWith("image/")) {
            String filename = row.originalName() != null ? row.originalName() : "attachment";
            builder = builder.header(
                org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                "attachment; filename=\"" + filename.replace("\"", "") + "\""
            );
        }
        return builder.body(new FileSystemResource(f.absolutePath()));
    }

    @Operation(summary = "获取附件元信息", description = "获取附件的 JSON 元数据")
    @GetMapping("/{id}/meta")
    public AttachmentResponse meta(@Parameter(description = "附件 ID") @PathVariable long id) {
        return AttachmentResponse.from(store.get(id));
    }

    @Operation(summary = "更新附件", description = "更新显示尺寸或文件名")
    @PutMapping("/{id}")
    public AttachmentResponse update(@Parameter(description = "附件 ID") @PathVariable long id, @RequestBody UpdateRequest body) {
        if (body == null) throw new IllegalArgumentException("请求体不能为空");
        if (body.getOriginalName() != null) {
            String name = body.getOriginalName().strip();
            if (name.isBlank()) throw new IllegalArgumentException("文件名不能为空");
            store.updateName(id, name);
        }
        if (body.getDisplaySize() != null) {
            int size = body.getDisplaySize();
            if (size < 1 || size > 100) throw new IllegalArgumentException("displaySize 必须在 1-100 之间");
            return AttachmentResponse.from(store.updateSize(id, size));
        }
        return AttachmentResponse.from(store.get(id));
    }

    @Operation(summary = "查询附件引用", description = "反查此附件被哪些任务/日志引用")
    @GetMapping("/{id}/references")
    public List<ReferenceDto> references(@Parameter(description = "附件 ID") @PathVariable long id) {
        store.get(id);
        return store.findReferences(id).stream().map(ReferenceDto::from).toList();
    }

    @Operation(summary = "删除附件", description = "删除附件（有引用时返回 409 冲突）")
    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@Parameter(description = "附件 ID") @PathVariable long id) {
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
        @com.fasterxml.jackson.annotation.JsonProperty("displaySize")
        private Integer displaySize;
        @com.fasterxml.jackson.annotation.JsonProperty("originalName")
        private String originalName;
        public Integer getDisplaySize() { return displaySize; }
        public void setDisplaySize(Integer displaySize) { this.displaySize = displaySize; }
        public String getOriginalName() { return originalName; }
        public void setOriginalName(String originalName) { this.originalName = originalName; }
    }

    public record ReferenceDto(
            String sourceType,
            long sourceId,
            String column,
            long taskId,
            String title,
            String logDate,
            String snippet,
            boolean deleted
    ) {
        public static ReferenceDto from(AttachmentStore.Reference r) {
            return new ReferenceDto(r.sourceType(), r.sourceId(), r.column(),
                    r.taskId(), r.title(), r.logDate(), r.snippet(), r.deleted());
        }
    }
}
