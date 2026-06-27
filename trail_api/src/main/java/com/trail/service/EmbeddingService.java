package com.trail.service;

import com.openai.client.OpenAIClient;
import com.openai.client.okhttp.OpenAIOkHttpClient;
import com.openai.models.embeddings.CreateEmbeddingResponse;
import com.openai.models.embeddings.EmbeddingCreateParams;
import com.trail.store.LLMSettingsStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Embedding 生成服务。
 * 读取向量模型配置（vector_api_key / vector_base_url / vector_model / vector_dimensions），
 * 调用 OpenAI-compatible API 生成 float 向量。
 */
@Service
public class EmbeddingService {

    private static final Logger log = LoggerFactory.getLogger(EmbeddingService.class);

    private static final String KEY_API_KEY    = "vector_api_key";
    private static final String KEY_BASE_URL   = "vector_base_url";
    private static final String KEY_MODEL      = "vector_model";
    private static final String KEY_DIMENSIONS = "vector_dimensions";
    private static final String KEY_ENABLED    = "vector_enabled";

    private static final String DEFAULT_MODEL  = "text-embedding-v4";
    private static final String DEFAULT_URL    = "https://dashscope.aliyuncs.com/compatible-mode/v1";

    private final LLMSettingsStore settingsStore;

    public EmbeddingService(LLMSettingsStore settingsStore) {
        this.settingsStore = settingsStore;
    }

    /**
     * 为单条文本生成 embedding 向量。
     * @param text 输入文本
     * @return float[] 向量
     */
    public float[] embed(String text) {
        if (text == null || text.isBlank()) {
            throw new IllegalArgumentException("文本不能为空");
        }
        Config cfg = loadConfig();

        OpenAIClient client = OpenAIOkHttpClient.builder()
                .apiKey(cfg.apiKey())
                .baseUrl(cfg.baseUrl())
                .build();

        EmbeddingCreateParams.Builder paramsBuilder = EmbeddingCreateParams.builder()
                .model(cfg.model())
                .input(EmbeddingCreateParams.Input.ofString(text));

        if (cfg.dimensions() > 0) {
            paramsBuilder.dimensions(cfg.dimensions());
        }

        CreateEmbeddingResponse response = client.embeddings().create(paramsBuilder.build());

        List<Float> values = response.data().get(0).embedding();
        float[] result = new float[values.size()];
        for (int i = 0; i < values.size(); i++) {
            result[i] = values.get(i);
        }
        log.debug("embed: text.len={} vector.dim={}", text.length(), result.length);
        return result;
    }

    /**
     * 检查向量功能是否已启用（API Key 已配置 且 vector_enabled=true）。
     */
    public boolean isEnabled() {
        try {
            String enabled = settingsStore.get(KEY_ENABLED);
            if (!"true".equals(enabled)) return false;
            String apiKey = settingsStore.get(KEY_API_KEY);
            return apiKey != null && !apiKey.isBlank();
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 快速检查向量模型是否已配置（无网络调用）。
     */
    public boolean isConfigured() {
        try {
            String apiKey = settingsStore.get(KEY_API_KEY);
            return apiKey != null && !apiKey.isBlank();
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 批量生成 embedding（逐条调用，避免超 token 限制）。
     */
    public float[][] embedBatch(List<String> texts) {
        float[][] results = new float[texts.size()][];
        for (int i = 0; i < texts.size(); i++) {
            results[i] = embed(texts.get(i));
        }
        return results;
    }

    private Config loadConfig() {
        String apiKey = settingsStore.get(KEY_API_KEY);
        if (apiKey == null || apiKey.isBlank()) {
            throw new RuntimeException("向量模型 API Key 未配置，请在设置 → 大模型 → 向量模型中配置");
        }
        String baseUrl = settingsStore.get(KEY_BASE_URL);
        String model   = settingsStore.get(KEY_MODEL);
        String dimsStr = settingsStore.get(KEY_DIMENSIONS);

        int dimensions = 0;
        if (dimsStr != null && !dimsStr.isBlank()) {
            try { dimensions = Integer.parseInt(dimsStr.strip()); } catch (NumberFormatException ignored) {}
        }

        return new Config(
            apiKey,
            baseUrl  != null && !baseUrl.isBlank()  ? baseUrl  : DEFAULT_URL,
            model    != null && !model.isBlank()     ? model    : DEFAULT_MODEL,
            dimensions
        );
    }

    private record Config(String apiKey, String baseUrl, String model, int dimensions) {}
}
