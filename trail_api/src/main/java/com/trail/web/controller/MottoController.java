package com.trail.web.controller;

import com.trail.store.LLMSettingsStore;
import com.trail.web.dto.MottoDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 座右铭 API
 */
@RestController
@RequestMapping("/api/settings/motto")
@Tag(name = "座右铭", description = "显示在侧栏底部的座右铭配置")
public class MottoController {

    private final LLMSettingsStore store;

    public MottoController(LLMSettingsStore store) {
        this.store = store;
    }

    @Operation(summary = "获取座右铭", description = "获取当前配置的座右铭")
    @GetMapping
    public MottoDto get() {
        String v = store.get("motto");
        return new MottoDto(v == null ? "" : v);
    }

    @Operation(summary = "保存座右铭", description = "设置新的座右铭")
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
