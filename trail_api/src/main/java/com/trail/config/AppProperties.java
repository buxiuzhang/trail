package com.trail.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * trail.* 配置绑定（M8 简化版）。
 * 数据目录相关字段由 DataDirService 运行时决定（env > user config > 未配置）。
 * 这里仅保留 `data-dir` 占位。
 */
@ConfigurationProperties(prefix = "trail")
public record AppProperties(
        String dataDir
) {}
