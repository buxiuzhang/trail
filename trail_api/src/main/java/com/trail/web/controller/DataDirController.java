package com.trail.web.controller;

import com.trail.config.DataDirService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.Map;

/**
 * 数据目录配置端点（M8）。
 *
 * GET /api/settings/data-dir → 永远 200（前端 DataDirGate 探测依赖；未配置也返 200）
 * PUT /api/settings/data-dir → 切换数据目录（运行时切 conn + 写 user config）
 *
 * 不走 requireConfigured() —— 这两个端点必须在未配置时也响应。
 */
@RestController
@RequestMapping("/api/settings/data-dir")
public class DataDirController {

    private final DataDirService dataDir;

    public DataDirController(DataDirService dataDir) {
        this.dataDir = dataDir;
    }

    @GetMapping
    public Map<String, Object> get() {
        Map<String, Object> r = new HashMap<>();
        if (dataDir.isConfigured()) {
            r.put("dataDir", dataDir.currentDataDir().toString());
        } else {
            // 未配置时返回默认建议路径，前端预填，用户点击确认后才初始化
            r.put("dataDir", dataDir.defaultDataDir().toString());
        }
        r.put("configured", dataDir.isConfigured());
        return r;
    }

    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, Object> body) {
        // 全局 SNAKE_CASE 不会转 Map 的 key（Jackson 只对 typed bean / record 走策略），
        // 因此前端发的 snake_case `data_dir` 不会自动变成 `dataDir`。兼容两种 key。
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
