package com.trail.web.controller;

import com.trail.store.LLMSettingsStore;
import com.trail.web.dto.MottoDto;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/settings/motto")
public class MottoController {

    private static final String DEFAULT_MOTTO = "凡录入者，皆为正典。\n凡未录者，皆为虚构。";

    private final LLMSettingsStore store;

    public MottoController(LLMSettingsStore store) {
        this.store = store;
    }

    @GetMapping
    public MottoDto get() {
        String v = store.get("motto");
        return new MottoDto(v == null || v.isBlank() ? DEFAULT_MOTTO : v);
    }

    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, String> body) {
        String m = body.get("motto");
        if (m == null || m.isBlank()) {
            store.delete("motto");
            return Map.of("ok", true, "motto", DEFAULT_MOTTO);
        }
        store.save("motto", m);
        return Map.of("ok", true, "motto", m);
    }
}
