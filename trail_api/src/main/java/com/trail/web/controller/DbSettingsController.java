package com.trail.web.controller;

import com.trail.config.DataDirService;
import com.trail.web.dto.DbSettingsDto;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/**
 * 数据源信息查询（M8 简化版）。
 *
 * GET /api/settings/db：返回当前数据目录 + backend（固定 "sqlite"）。前端兼容用。
 * PUT /api/settings/db：M8 不再支持切换 backend（固定 SQLite；切路径走 PUT /api/settings/data-dir）。
 *   返 410 Gone 提示。
 */
@RestController
@RequestMapping("/api/settings/db")
public class DbSettingsController {

    private final DataDirService dataDir;

    public DbSettingsController(DataDirService dataDir) {
        this.dataDir = dataDir;
    }

    @GetMapping
    public DbSettingsDto get() {
        String absPath = dataDir.currentDbPath() == null ? null : dataDir.currentDbPath().toString();
        return new DbSettingsDto(
                "sqlite",
                new DbSettingsDto.DuckDbInfo("db/tasks.sqlite", absPath == null ? "" : absPath),
                Map.of("host", "127.0.0.1", "port", 3306, "user", "", "password", "", "database", ""),
                Map.of("duckdb_path", "db/tasks.sqlite")
        );
    }

    @org.springframework.web.bind.annotation.PutMapping
    public Map<String, Object> save(@org.springframework.web.bind.annotation.RequestBody Map<String, Object> body) {
        throw new ResponseStatusException(HttpStatus.GONE,
                "M8 起 backend 固定为 sqlite；切数据目录请用 PUT /api/settings/data-dir");
    }
}
