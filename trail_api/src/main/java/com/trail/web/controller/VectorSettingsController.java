package com.trail.web.controller;

import com.trail.store.LLMSettingsStore;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 向量模型配置（用于 LanceDB 向量检索）
 */
@RestController
@RequestMapping("/api/settings/vector")
@Tag(name = "向量模型设置", description = "配置 Embedding 模型 API Key、Base URL 和模型名称")
public class VectorSettingsController {

    private static final String KEY_API_KEY    = "vector_api_key";
    private static final String KEY_BASE_URL   = "vector_base_url";
    private static final String KEY_MODEL      = "vector_model";
    private static final String KEY_DIMENSIONS = "vector_dimensions";
    private static final String KEY_ENABLED    = "vector_enabled";

    private final LLMSettingsStore store;

    public VectorSettingsController(LLMSettingsStore store) {
        this.store = store;
    }

    @Operation(summary = "获取向量模型配置")
    @GetMapping
    public Map<String, Object> get() {
        String apiKey    = store.get(KEY_API_KEY);
        String baseUrl   = store.get(KEY_BASE_URL);
        String model     = store.get(KEY_MODEL);
        String dims      = store.get(KEY_DIMENSIONS);

        String masked = "";
        if (apiKey != null && !apiKey.isBlank()) {
            masked = apiKey.length() > 8
                ? apiKey.substring(0, 4) + "****" + apiKey.substring(apiKey.length() - 4)
                : "****";
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("api_key_masked", masked);
        result.put("base_url",   baseUrl   != null ? baseUrl   : "");
        result.put("model",      model     != null ? model     : "");
        result.put("dimensions", dims      != null ? dims      : "");
        String enabledVal = store.get(KEY_ENABLED);
        result.put("enabled", "true".equals(enabledVal));
        return result;
    }

    @Operation(summary = "保存向量模型配置")
    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, String> body) {
        // api_key：只有明确传且非空才更新，没传则保持不变（防止点保存时清空 key）
        String apiKey = body.get("api_key");
        if (apiKey != null && !apiKey.isBlank()) {
            store.save(KEY_API_KEY, apiKey.strip());
        }
        saveOrDelete(KEY_BASE_URL,   body.get("base_url"));
        saveOrDelete(KEY_MODEL,      body.get("model"));
        saveOrDelete(KEY_DIMENSIONS, body.get("dimensions"));
        String enabled = body.get("enabled");
        if (enabled != null) {
            store.save(KEY_ENABLED, "true".equals(enabled) ? "true" : "false");
        }
        return Map.of("ok", true);
    }

    private void saveOrDelete(String key, String value) {
        if (value == null || value.isBlank()) {
            store.delete(key);
        } else {
            store.save(key, value.strip());
        }
    }
}
