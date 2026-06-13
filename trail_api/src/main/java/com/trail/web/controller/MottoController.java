package com.trail.web.controller;

import com.trail.store.LLMSettingsStore;
import com.trail.web.dto.MottoDto;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 座右铭 API。
 *
 * 默认值在 application.yml 的 trail.defaults.motto 配置，
 * 启动时由 DefaultSettingsInitializer 初始化到数据库。
 */
@RestController
@RequestMapping("/api/settings/motto")
public class MottoController {

    private final LLMSettingsStore store;

    public MottoController(LLMSettingsStore store) {
        this.store = store;
    }

    @GetMapping
    public MottoDto get() {
        String v = store.get("motto");
        return new MottoDto(v == null ? "" : v);
    }

    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, String> body) {
        String m = body.get("motto");
        if (m == null || m.isBlank()) {
            store.delete("motto");
            return Map.of("ok", true, "motto", "");
        }
        store.save("motto", m);
        return Map.of("ok", true, "motto", m);
    }
}