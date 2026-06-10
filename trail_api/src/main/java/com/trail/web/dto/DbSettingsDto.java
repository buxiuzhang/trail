package com.trail.web.dto;

import java.util.Map;

public record DbSettingsDto(
        String backend,
        DuckDbInfo duckdb,
        Map<String, Object> mysql,
        Map<String, Object> defaults
) {
    public record DuckDbInfo(String path, String absolutePath) {}
}
