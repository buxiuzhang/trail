package com.trail.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** MCP Server 配置 DTO（request + response 共用）。 */
public record McpServerDto(
        String id,
        @NotBlank String name,
        @Pattern(regexp = "stdio|sse", message = "type 必须是 stdio 或 sse") String type,
        String command,
        String args,
        String env,
        String url,
        String headers,
        Boolean enabled,
        String createdAt
) {}
