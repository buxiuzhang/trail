package com.trail.web.controller;

import com.trail.llm.Prompts;
import com.trail.service.LlmService;
import com.trail.store.LLMSettingsStore;
import com.trail.web.dto.LlmSettingsDto;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/settings/llm")
public class LlmSettingsController {

    private final LLMSettingsStore store;
    private final LlmService llmService;

    public LlmSettingsController(LLMSettingsStore store, LlmService llmService) {
        this.store = store;
        this.llmService = llmService;
    }

    @GetMapping
    public LlmSettingsDto get() {
        Map<String, String> all = store.getAll();
        return new LlmSettingsDto(
                all.getOrDefault("api_key", ""),
                all.getOrDefault("base_url", ""),
                all.getOrDefault("model", ""),
                all.getOrDefault("max_tokens", "1000"),
                // Prompt 模板
                all.getOrDefault("chat_system_prompt", Prompts.DEFAULT_CHAT_SYSTEM),
                all.getOrDefault("polish_system_prompt", Prompts.POLISH_SYSTEM),
                all.getOrDefault("polish_todo_system_prompt", Prompts.POLISH_TODO_SYSTEM),
                all.getOrDefault("summarize_system_prompt", Prompts.SUMMARIZE_MAIN_SYSTEM),
                all.getOrDefault("summarize_maintenance_prompt", Prompts.SUMMARIZE_MAINTENANCE_SYSTEM),
                all.getOrDefault("ask_maintenance_prompt", Prompts.ASK_MAINTENANCE_SYSTEM),
                all.getOrDefault("tools_desc", Prompts.TOOLS_DESC),
                // 日报/周报模板
                all.getOrDefault("daily_report_template", Prompts.DEFAULT_DAILY_REPORT_TEMPLATE),
                all.getOrDefault("weekly_report_template", Prompts.DEFAULT_WEEKLY_REPORT_TEMPLATE)
        );
    }

    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, String> data) {
        // 连接配置
        if (data.containsKey("api_key")) store.save("api_key", data.get("api_key") == null ? "" : data.get("api_key"));
        if (data.containsKey("base_url")) store.save("base_url", data.get("base_url") == null ? "" : data.get("base_url"));
        if (data.containsKey("model")) store.save("model", data.get("model") == null ? "" : data.get("model"));
        if (data.containsKey("max_tokens")) store.save("max_tokens", data.get("max_tokens") == null ? "" : data.get("max_tokens"));
        // Prompt 模板
        if (data.containsKey("chat_system_prompt")) {
            String p = data.get("chat_system_prompt");
            if (p == null || p.isBlank()) store.delete("chat_system_prompt");
            else store.save("chat_system_prompt", p);
        }
        if (data.containsKey("polish_system_prompt")) {
            String p = data.get("polish_system_prompt");
            if (p == null || p.isBlank()) store.delete("polish_system_prompt");
            else store.save("polish_system_prompt", p);
        }
        if (data.containsKey("polish_todo_system_prompt")) {
            String p = data.get("polish_todo_system_prompt");
            if (p == null || p.isBlank()) store.delete("polish_todo_system_prompt");
            else store.save("polish_todo_system_prompt", p);
        }
        if (data.containsKey("summarize_system_prompt")) {
            String p = data.get("summarize_system_prompt");
            if (p == null || p.isBlank()) store.delete("summarize_system_prompt");
            else store.save("summarize_system_prompt", p);
        }
        if (data.containsKey("summarize_maintenance_prompt")) {
            String p = data.get("summarize_maintenance_prompt");
            if (p == null || p.isBlank()) store.delete("summarize_maintenance_prompt");
            else store.save("summarize_maintenance_prompt", p);
        }
        if (data.containsKey("ask_maintenance_prompt")) {
            String p = data.get("ask_maintenance_prompt");
            if (p == null || p.isBlank()) store.delete("ask_maintenance_prompt");
            else store.save("ask_maintenance_prompt", p);
        }
        if (data.containsKey("tools_desc")) {
            String p = data.get("tools_desc");
            if (p == null || p.isBlank()) store.delete("tools_desc");
            else store.save("tools_desc", p);
        }
        // 日报/周报模板
        if (data.containsKey("daily_report_template")) {
            String p = data.get("daily_report_template");
            if (p == null || p.isBlank()) store.delete("daily_report_template");
            else store.save("daily_report_template", p);
        }
        if (data.containsKey("weekly_report_template")) {
            String p = data.get("weekly_report_template");
            if (p == null || p.isBlank()) store.delete("weekly_report_template");
            else store.save("weekly_report_template", p);
        }
        // 刷新 LlmService 的 prompt 缓存
        llmService.refreshPrompts();
        return Map.of("ok", true);
    }
}
