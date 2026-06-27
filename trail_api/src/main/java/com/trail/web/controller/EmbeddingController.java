package com.trail.web.controller;

import com.trail.db.SqliteDb;
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

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(EmbeddingController.class);

    private final EmbeddingService embeddingService;
    private final VectorStore vectorStore;
    private final VectorInitService vectorInitService;
    private final SqliteDb db;

    public EmbeddingController(EmbeddingService embeddingService, VectorStore vectorStore,
                                VectorInitService vectorInitService, SqliteDb db) {
        this.embeddingService = embeddingService;
        this.vectorStore = vectorStore;
        this.vectorInitService = vectorInitService;
        this.db = db;
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

    @Operation(summary = "全局语义搜索", description = "跨任务/日报/待办做向量检索，向量模型未配置时返回 configured:false")
    @GetMapping("/search")
    public Map<String, Object> search(
            @RequestParam String q,
            @RequestParam(defaultValue = "10") int limit,
            @RequestParam(required = false) String source) {
        if (!embeddingService.isEnabled()) {
            return Map.of("configured", false, "results", java.util.List.of());
        }
        if (q == null || q.isBlank()) {
            return Map.of("configured", true, "results", java.util.List.of());
        }
        try {
            float[] vec = embeddingService.embed(q);
            java.util.List<VectorStore.SearchResult> hits = vectorStore.search(vec, limit * 2);
            java.util.List<java.util.Map<String, Object>> results = hits.stream()
                .filter(h -> source == null || source.isBlank() || source.equals(h.source()))
                .filter(h -> h.score() >= 0.35f)
                .limit(limit)
                .map(h -> {
                    java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                    m.put("id", h.id());
                    m.put("source", h.source());
                    m.put("score", Math.round(h.score() * 1000) / 1000.0);
                    m.put("text", h.text().length() > 200 ? h.text().substring(0, 200) + "…" : h.text());
                    // 解析 entity id，查出 task_id 供前端跳转
                    String entityIdStr = h.id().contains(":") ? h.id().split(":", 2)[1] : null;
                    if (entityIdStr != null) {
                        try {
                            long entityId = Long.parseLong(entityIdStr);
                            if ("task".equals(h.source())) {
                                m.put("task_id", entityId);
                            } else if ("log".equals(h.source())) {
                                java.util.List<java.util.Map<String, Object>> rows =
                                    db.query("SELECT task_id FROM work_logs WHERE id = ?", entityId);
                                if (!rows.isEmpty()) m.put("task_id", rows.get(0).get("task_id"));
                            } else if ("todo".equals(h.source())) {
                                java.util.List<java.util.Map<String, Object>> rows =
                                    db.query("SELECT task_id FROM todos WHERE id = ?", entityId);
                                if (!rows.isEmpty()) m.put("task_id", rows.get(0).get("task_id"));
                            }
                        } catch (NumberFormatException ignored) {}
                    }
                    return m;
                })
                .toList();
            return Map.of("configured", true, "results", results);
        } catch (Exception e) {
            log.warn("语义搜索失败: {}", e.getMessage(), e);
            return Map.of("configured", true, "results", java.util.List.of(), "error", e.getMessage());
        }
    }
}
