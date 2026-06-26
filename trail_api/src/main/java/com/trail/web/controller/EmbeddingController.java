package com.trail.web.controller;

import com.trail.service.EmbeddingService;
import com.trail.store.VectorStore;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Embedding 测试接口
 *
 * POST /api/embed          — 生成向量并写入 LanceDB
 * GET  /api/embed/stats    — 查询向量表统计
 */
@RestController
@RequestMapping("/api/embed")
@Tag(name = "向量 Embedding", description = "生成文本 Embedding 并存储到 LanceDB")
public class EmbeddingController {

    private final EmbeddingService embeddingService;
    private final VectorStore vectorStore;

    public EmbeddingController(EmbeddingService embeddingService, VectorStore vectorStore) {
        this.embeddingService = embeddingService;
        this.vectorStore = vectorStore;
    }

    @Operation(summary = "生成 Embedding 并写入 LanceDB")
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

    @Operation(summary = "向量表统计")
    @GetMapping("/stats")
    public Map<String, Object> stats() {
        return Map.of(
            "rows", vectorStore.countRows(),
            "ids",  vectorStore.listIds()
        );
    }
}
