package com.trail.web.controller;

import com.trail.config.DataDirService;
import com.trail.web.dto.DbSettingsDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/**
 * 数据源信息查询
 */
@RestController
@RequestMapping("/api/settings/db")
@Tag(name = "数据库设置", description = "数据源路径信息")
public class DbSettingsController {

    private final DataDirService dataDir;

    public DbSettingsController(DataDirService dataDir) {
        this.dataDir = dataDir;
    }

    @Operation(summary = "获取数据库信息", description = "获取当前 SQLite 数据库路径")
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

    @Operation(summary = "切换数据库（已废弃）", description = "M8 起固定使用 SQLite，请用 /api/settings/data-dir 切换路径")
    @org.springframework.web.bind.annotation.PutMapping
    public Map<String, Object> save(@org.springframework.web.bind.annotation.RequestBody Map<String, Object> body) {
        throw new ResponseStatusException(HttpStatus.GONE,
                "M8 起 backend 固定为 sqlite；切数据目录请用 PUT /api/settings/data-dir");
    }
}