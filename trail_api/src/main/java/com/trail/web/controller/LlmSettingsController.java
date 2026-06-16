package com.trail.web.controller;

import com.trail.crypto.RsaKeyService;
import com.trail.service.LlmService;
import com.trail.store.LLMSettingsStore;
import com.trail.web.dto.LlmSettingsDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * LLM 配置 API
 */
@RestController
@RequestMapping("/api/settings/llm")
@Tag(name = "LLM 配置", description = "大模型 API Key、模型、Prompt 模板等配置")
public class LlmSettingsController {

    private final LLMSettingsStore store;
    private final LlmService llmService;
    private final RsaKeyService rsaKeyService;

    public LlmSettingsController(LLMSettingsStore store, LlmService llmService, RsaKeyService rsaKeyService) {
        this.store = store;
        this.llmService = llmService;
        this.rsaKeyService = rsaKeyService;
    }

    @Operation(summary = "获取 LLM 配置", description = "获取 API Key（遮蔽）、模型、Prompt 模板等配置")
    @GetMapping
    public LlmSettingsDto get() {
        Map<String, String> all = store.getAll();
        String apiKey = all.getOrDefault("api_key", "");
        return new LlmSettingsDto(
                maskApiKey(apiKey),
                rsaKeyService.encryptForFrontend(apiKey),
                all.getOrDefault("base_url", ""),
                all.getOrDefault("model", ""),
                all.getOrDefault("max_tokens", "1000"),
                all.getOrDefault("min_tokens", "0"),
                all.getOrDefault("auth_type", "bearer"),
                all.getOrDefault("chat_system_prompt", ""),
                all.getOrDefault("polish_system_prompt", ""),
                all.getOrDefault("polish_todo_system_prompt", ""),
                all.getOrDefault("summarize_system_prompt", ""),
                all.getOrDefault("summarize_maintenance_prompt", ""),
                all.getOrDefault("ask_maintenance_prompt", ""),
                all.getOrDefault("tools_desc", ""),
                all.getOrDefault("daily_report_template", ""),
                all.getOrDefault("weekly_report_template", ""),
                all.getOrDefault("speech_duration", "10")
        );
    }

    @Operation(summary = "保存 LLM 配置", description = "保存 API Key（支持 RSA 加密传输）、模型、Prompt 模板等配置")
    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, String> data) {
        if (data.containsKey("api_key_encrypted")) {
            String encrypted = data.get("api_key_encrypted");
            if (encrypted != null && !encrypted.isBlank()) {
                String decrypted = rsaKeyService.decrypt(encrypted);
                store.save("api_key", decrypted);
            }
        }
        if (data.containsKey("api_key") && !data.containsKey("api_key_encrypted")) {
            store.save("api_key", data.get("api_key") == null ? "" : data.get("api_key"));
        }

        saveIfPresent(data, "base_url");
        saveIfPresent(data, "model");
        saveIfPresent(data, "max_tokens");
        saveIfPresent(data, "min_tokens");
        saveIfPresent(data, "auth_type");

        saveIfPresent(data, "chat_system_prompt");
        saveIfPresent(data, "polish_system_prompt");
        saveIfPresent(data, "polish_todo_system_prompt");
        saveIfPresent(data, "summarize_system_prompt");
        saveIfPresent(data, "summarize_maintenance_prompt");
        saveIfPresent(data, "ask_maintenance_prompt");
        saveIfPresent(data, "tools_desc");

        saveIfPresent(data, "daily_report_template");
        saveIfPresent(data, "weekly_report_template");

        saveIfPresent(data, "speech_duration");

        llmService.refreshPrompts();
        return Map.of("ok", true);
    }

    private void saveIfPresent(Map<String, String> data, String key) {
        if (data.containsKey(key)) {
            String value = data.get(key);
            if (value == null || value.isBlank()) {
                store.delete(key);
            } else {
                store.save(key, value);
            }
        }
    }

    private String maskApiKey(String key) {
        if (key == null || key.isEmpty()) return "";
        if (key.length() <= 8) return "****";
        return key.substring(0, 4) + "****" + key.substring(key.length() - 4);
    }
}
