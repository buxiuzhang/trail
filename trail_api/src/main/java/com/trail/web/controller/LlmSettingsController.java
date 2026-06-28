package com.trail.web.controller;

import com.trail.crypto.RsaKeyService;
import com.trail.service.LlmService;
import com.trail.store.LLMSettingsStore;
import com.trail.web.dto.LlmSettingsDto;
import com.trail.web.ws.WatchAlertScheduler;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

import com.trail.web.ws.TodoAlertScheduler;

@RestController
@RequestMapping("/api/settings/llm")
@Tag(name = "LLM 配置", description = "大模型 API Key、模型、Prompt 模板等配置")
public class LlmSettingsController {

    private final LLMSettingsStore store;
    private final LlmService llmService;
    private final RsaKeyService rsaKeyService;
    private final WatchAlertScheduler watchAlertScheduler;
    private final TodoAlertScheduler todoAlertScheduler;

    public LlmSettingsController(LLMSettingsStore store, LlmService llmService,
                                 RsaKeyService rsaKeyService, WatchAlertScheduler watchAlertScheduler,
                                 TodoAlertScheduler todoAlertScheduler) {
        this.store = store;
        this.llmService = llmService;
        this.rsaKeyService = rsaKeyService;
        this.watchAlertScheduler = watchAlertScheduler;
        this.todoAlertScheduler = todoAlertScheduler;
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
                all.getOrDefault("polish_task_desc_system_prompt", ""),
                all.getOrDefault("summarize_system_prompt", ""),
                all.getOrDefault("summarize_maintenance_prompt", ""),
                all.getOrDefault("ask_maintenance_prompt", ""),
                all.getOrDefault("batch_tag_system_prompt", ""),
                all.getOrDefault("speech_duration", "10"),
                all.getOrDefault("max_tool_iterations", "30"),
                all.getOrDefault("watch_idle_hot_days", "3"),
                all.getOrDefault("watch_idle_warn_days", "14"),
                all.getOrDefault("watch_snooze_minutes", "30"),
                all.getOrDefault("watch_cron", "0 9,14 * * 1-5"),
                all.getOrDefault("todo_idle_warn_days", "7"),
                all.getOrDefault("todo_cron", "0 9,14 * * 1-5"),
                all.getOrDefault("watch_alert_template", ""),
                all.getOrDefault("todo_alert_template", "")
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
        saveIfPresent(data, "polish_task_desc_system_prompt");
        saveIfPresent(data, "summarize_system_prompt");
        saveIfPresent(data, "summarize_maintenance_prompt");
        saveIfPresent(data, "ask_maintenance_prompt");

        saveIfPresent(data, "batch_tag_system_prompt");

        saveIfPresent(data, "speech_duration");
        saveIfPresent(data, "max_tool_iterations");
        saveIfPresent(data, "watch_idle_hot_days");
        saveIfPresent(data, "watch_idle_warn_days");
        saveIfPresent(data, "watch_snooze_minutes");
        saveIfPresent(data, "watch_cron");
        saveIfPresent(data, "todo_idle_warn_days");
        saveIfPresent(data, "todo_cron");
        saveIfPresent(data, "watch_alert_template");
        saveIfPresent(data, "todo_alert_template");

        llmService.refreshPrompts();
        watchAlertScheduler.reschedule();
        todoAlertScheduler.reschedule();
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
