package com.trail.web.controller;

import com.trail.store.AttachmentStore;
import com.trail.store.LLMSettingsStore;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.stream.Collectors;

/**
 * 附件上传限制配置：允许的文件类型和单文件大小上限
 */
@RestController
@RequestMapping("/api/settings/attachment")
@Tag(name = "附件设置", description = "配置允许的文件类型和单文件大小上限")
public class AttachmentSettingsController {

    private static final String KEY_ALLOWED_MIMES = "attachment_allowed_mimes";
    private static final String KEY_MAX_BYTES = "attachment_max_bytes";
    private static final long DEFAULT_MAX_BYTES = 50L * 1024 * 1024;

    private final LLMSettingsStore store;
    private final AttachmentStore attachmentStore;

    public AttachmentSettingsController(LLMSettingsStore store, AttachmentStore attachmentStore) {
        this.store = store;
        this.attachmentStore = attachmentStore;
    }

    @Operation(summary = "获取附件上传设置")
    @GetMapping
    public Map<String, Object> get() {
        String allowedMimes = store.get(KEY_ALLOWED_MIMES);
        String maxBytesStr = store.get(KEY_MAX_BYTES);
        long maxBytes = DEFAULT_MAX_BYTES;
        if (maxBytesStr != null && !maxBytesStr.isBlank()) {
            try { maxBytes = Long.parseLong(maxBytesStr.strip()); } catch (NumberFormatException ignored) {}
        }
        // 返回有效 MIME 列表（逗号分隔）和 max_bytes
        String effectiveMimes = attachmentStore.getAllowedMimes().stream()
                .sorted().collect(Collectors.joining(","));
        return Map.of(
            "allowed_mimes", allowedMimes == null ? "" : allowedMimes,
            "effective_mimes", effectiveMimes,
            "max_bytes", maxBytes
        );
    }

    @Operation(summary = "保存附件上传设置")
    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, Object> body) {
        // allowed_mimes: 逗号分隔字符串，空表示恢复默认
        Object mimesVal = body.get("allowed_mimes");
        if (mimesVal instanceof String mimes && !mimes.isBlank()) {
            store.save(KEY_ALLOWED_MIMES, mimes.strip());
        } else {
            store.delete(KEY_ALLOWED_MIMES);
        }

        // max_bytes: long
        Object maxVal = body.get("max_bytes");
        if (maxVal instanceof Number num && num.longValue() > 0) {
            store.save(KEY_MAX_BYTES, String.valueOf(num.longValue()));
        } else {
            store.delete(KEY_MAX_BYTES);
        }

        return Map.of("ok", true);
    }
}
