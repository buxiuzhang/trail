package com.trail.web.controller;

import com.trail.store.LLMSettingsStore;
import com.trail.web.dto.LlmSettingsDto;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/settings/llm")
public class LlmSettingsController {

    private static final String DEFAULT_CHAT_PROMPT = """
            你是 Trail 工作日志助教。你帮助用户回顾工作进展、整理任务状态、回答关于工作日志的问题。
            回答使用中文，简洁、有条理，用第二人称（你/您）。
            回答可以适当使用条目列表，但不要用 Markdown 标题（#）。""";

    private final LLMSettingsStore store;

    public LlmSettingsController(LLMSettingsStore store) {
        this.store = store;
    }

    @GetMapping
    public LlmSettingsDto get() {
        Map<String, String> all = store.getAll();
        return new LlmSettingsDto(
                all.getOrDefault("api_key", ""),
                all.getOrDefault("base_url", ""),
                all.getOrDefault("model", ""),
                all.getOrDefault("max_tokens", "1000"),
                all.getOrDefault("chat_system_prompt", DEFAULT_CHAT_PROMPT),
                all.getOrDefault("tools_desc", "")
        );
    }

    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, String> data) {
        if (data.containsKey("api_key")) store.save("api_key", data.get("api_key") == null ? "" : data.get("api_key"));
        if (data.containsKey("base_url")) store.save("base_url", data.get("base_url") == null ? "" : data.get("base_url"));
        if (data.containsKey("model")) store.save("model", data.get("model") == null ? "" : data.get("model"));
        if (data.containsKey("max_tokens")) store.save("max_tokens", data.get("max_tokens") == null ? "" : data.get("max_tokens"));
        if (data.containsKey("chat_system_prompt")) {
            String p = data.get("chat_system_prompt");
            if (p == null || p.isBlank()) store.delete("chat_system_prompt");
            else store.save("chat_system_prompt", p);
        }
        return Map.of("ok", true);
    }
}
