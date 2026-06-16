package com.trail.web.controller;

import com.trail.config.DataDirService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.Map;

/**
 * 数据目录配置端点
 */
@RestController
@RequestMapping("/api/settings/data-dir")
@Tag(name = "数据目录", description = "数据存储路径的配置与切换")
public class DataDirController {

    private final DataDirService dataDir;

    public DataDirController(DataDirService dataDir) {
        this.dataDir = dataDir;
    }

    @Operation(summary = "获取数据目录", description = "获取当前数据目录路径及配置状态")
    @GetMapping
    public Map<String, Object> get() {
        Map<String, Object> r = new HashMap<>();
        if (dataDir.isConfigured()) {
            r.put("dataDir", dataDir.currentDataDir().toString());
        } else {
            r.put("dataDir", dataDir.defaultDataDir().toString());
        }
        r.put("configured", dataDir.isConfigured());
        return r;
    }

    @Operation(summary = "切换数据目录", description = "切换到新的数据目录，自动初始化数据库")
    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, Object> body) {
        Object raw = body.get("dataDir");
        if (raw == null) raw = body.get("data_dir");
        String path = raw == null ? null : raw.toString();
        if (path == null || path.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "dataDir 不能为空");
        }
        try {
            dataDir.switchTo(path);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        } catch (RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "切换失败：" + e.getMessage());
        }
        Map<String, Object> r = new HashMap<>();
        r.put("ok", true);
        r.put("dataDir", dataDir.currentDataDir().toString());
        r.put("configured", true);
        return r;
    }
}
