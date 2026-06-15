package com.trail.web.controller;

import com.trail.crypto.RsaKeyService;
import com.trail.service.LlmService;
import com.trail.store.LLMSettingsStore;
import com.trail.web.dto.LlmSettingsDto;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * LLM 配置 API。
 *
 * GET  /api/settings/llm - 获取配置
 * PUT  /api/settings/llm - 保存配置（apiKey 支持 RSA 加密传输）
 *
 * 默认值在 application.yml 的 trail.defaults 配置，
 * 启动时由 DefaultSettingsInitializer 初始化到数据库。
 */
@RestController
@RequestMapping("/api/settings/llm")
public class LlmSettingsController {

    private final LLMSettingsStore store;
    private final LlmService llmService;
    private final RsaKeyService rsaKeyService;

    public LlmSettingsController(LLMSettingsStore store, LlmService llmService, RsaKeyService rsaKeyService) {
        this.store = store;
        this.llmService = llmService;
        this.rsaKeyService = rsaKeyService;
    }

    /**
     * 获取 LLM 配置。
     *
     * - apiKeyMasked: 遮蔽值（用于显示）
     * - apiKeyEncrypted: RSA 加密后的完整值（用于前端请求解密端点显示明文）
     */
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
                // Prompt 模板（直接从数据库读取，默认值已初始化）
                all.getOrDefault("chat_system_prompt", ""),
                all.getOrDefault("polish_system_prompt", ""),
                all.getOrDefault("polish_todo_system_prompt", ""),
                all.getOrDefault("summarize_system_prompt", ""),
                all.getOrDefault("summarize_maintenance_prompt", ""),
                all.getOrDefault("ask_maintenance_prompt", ""),
                all.getOrDefault("tools_desc", ""),
                // 日报/周报模板
                all.getOrDefault("daily_report_template", ""),
                all.getOrDefault("weekly_report_template", ""),
                // 语音输入时长
                all.getOrDefault("speech_duration", "10")
        );
    }

    /**
     * 保存 LLM 配置。
     *
     * api_key_encrypted: RSA 加密后的 API Key
     */
    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, String> data) {
        // API Key 加密传输
        if (data.containsKey("api_key_encrypted")) {
            String encrypted = data.get("api_key_encrypted");
            if (encrypted != null && !encrypted.isBlank()) {
                String decrypted = rsaKeyService.decrypt(encrypted);
                store.save("api_key", decrypted);
            }
        }
        // 明文 api_key（兼容旧版本，但不推荐）
        if (data.containsKey("api_key") && !data.containsKey("api_key_encrypted")) {
            store.save("api_key", data.get("api_key") == null ? "" : data.get("api_key"));
        }

        // 连接配置
        saveIfPresent(data, "base_url");
        saveIfPresent(data, "model");
        saveIfPresent(data, "max_tokens");
        saveIfPresent(data, "min_tokens");
        saveIfPresent(data, "auth_type");

        // Prompt 模板
        saveIfPresent(data, "chat_system_prompt");
        saveIfPresent(data, "polish_system_prompt");
        saveIfPresent(data, "polish_todo_system_prompt");
        saveIfPresent(data, "summarize_system_prompt");
        saveIfPresent(data, "summarize_maintenance_prompt");
        saveIfPresent(data, "ask_maintenance_prompt");
        saveIfPresent(data, "tools_desc");

        // 日报/周报模板
        saveIfPresent(data, "daily_report_template");
        saveIfPresent(data, "weekly_report_template");

        // 语音输入时长
        saveIfPresent(data, "speech_duration");

        // 刷新 LlmService 的 prompt 缓存
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

    /**
     * 遮蔽 API Key。
     * 格式：前4位****后4位
     */
    private String maskApiKey(String key) {
        if (key == null || key.isEmpty()) return "";
        if (key.length() <= 8) return "****";
        return key.substring(0, 4) + "****" + key.substring(key.length() - 4);
    }
}