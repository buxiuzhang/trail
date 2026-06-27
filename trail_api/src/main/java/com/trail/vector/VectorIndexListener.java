package com.trail.vector;

import com.trail.service.EmbeddingService;
import com.trail.store.VectorStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

/**
 * 异步消费 VectorIndexEvent，将文本向量化后写入 VectorStore。
 * 向量模型未配置或 API 失败时静默记录 warn，对业务主流程完全无感知。
 */
@Component
public class VectorIndexListener {

    private static final Logger log = LoggerFactory.getLogger(VectorIndexListener.class);

    private final EmbeddingService embeddingService;
    private final VectorStore vectorStore;

    public VectorIndexListener(EmbeddingService embeddingService, VectorStore vectorStore) {
        this.embeddingService = embeddingService;
        this.vectorStore = vectorStore;
    }

    @Async("vectorIndexExecutor")
    @EventListener
    public void onEvent(VectorIndexEvent event) {
        try {
            if (!embeddingService.isEnabled()) return;
            if (event instanceof VectorIndexEvent.Upsert u) {
                if (u.text() == null || u.text().isBlank()) return;
                float[] vector = embeddingService.embed(u.text());
                vectorStore.upsert(u.id(), u.source(), u.text(), vector);
                log.debug("vector upsert ok: id={}", u.id());
            } else if (event instanceof VectorIndexEvent.Delete d) {
                vectorStore.delete(d.id());
                log.debug("vector delete ok: id={}", d.id());
            }
        } catch (Exception e) {
            log.warn("向量索引失败（已忽略）event={} msg={}", event.getClass().getSimpleName(), e.getMessage());
        }
    }
}
