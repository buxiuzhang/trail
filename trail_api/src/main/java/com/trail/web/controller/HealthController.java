package com.trail.web.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@Tag(name = "健康检查", description = "服务状态检测")
public class HealthController {

    @Operation(summary = "健康检查", description = "检测服务是否正常运行")
    @GetMapping("/api/health")
    public Map<String, Object> health() {
        return Map.of("ok", true, "version", "0.3.0");
    }
}