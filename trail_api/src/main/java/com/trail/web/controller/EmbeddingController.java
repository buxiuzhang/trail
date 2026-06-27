package com.trail.web.controller;

import com.trail.service.EmbeddingService;
import com.trail.store.VectorStore;
import com.trail.vector.VectorInitService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Embedding 接口
 *
 * POST /api/embed            — 生成向量并写入向量存储（测试用）
 * POST /api/embed/init       — 启动全量初始化（异步，立即返回）
 * GET  /api/embed/init/status — 查询初始化进度
 * GET  /api/embed/stats      — 查询向量表统计
 */
@RestController
@RequestMapping("/api/embed")
@Tag(name = "向量 Embedding", description = "生成文本 Embedding 并存储到向量库")
public class EmbeddingController {

    private final EmbeddingService embeddingService;
    private final VectorStore vectorStore;
    private final VectorInitService vectorInitService;

    public EmbeddingController(EmbeddingService embeddingService, VectorStore vectorStore,
                                VectorInitService vectorInitService) {
        this.embeddingService = embeddingService;
        this.vectorStore = vectorStore;
        this.vectorInitService = vectorInitService;
    }

    @Operation(summary = "生成 Embedding 并写入向量库")
    @PostMapping
    public Map<String, Object> embed(@RequestBody Map<String, String> body) {
        String id     = body.getOrDefault("id", "test:" + System.currentTimeMillis());
        String source = body.getOrDefault("source", "manual");
        String text   = body.get("text");
        if (text == null || text.isBlank()) {
            throw new IllegalArgumentException("text 不能为空");
        }

        long t0 = System.currentTimeMillis();
        float[] vector = embeddingService.embed(text);
        long embedMs = System.currentTimeMillis() - t0;

        vectorStore.upsert(id, source, text, vector);

        return Map.of(
            "id", id,
            "dim", vector.length,
            "embed_ms", embedMs,
            "rows", vectorStore.countRows()
        );
    }

    @Operation(summary = "启动全量初始化（异步）",
               description = "将所有 tasks / work_logs / todos 写入向量库。skip_existing=true（默认）时跳过已有条目。立即返回，通过 /init/status 轮询进度。")
    @PostMapping("/init")
    public Map<String, Object> startInit(
            @RequestParam(name = "skip_existing", defaultValue = "true") boolean skipExisting) {
        return vectorInitService.startAsync(skipExisting);
    }

    @Operation(summary = "查询初始化进度")
    @GetMapping("/init/status")
    public Map<String, Object> initStatus() {
        return vectorInitService.getStatus();
    }

    @Operation(summary = "向量表统计")
    @GetMapping("/stats")
    public Map<String, Object> stats() {
        return Map.of(
            "rows", vectorStore.countRows(),
            "ids",  vectorStore.listIds()
        );
    }
}
