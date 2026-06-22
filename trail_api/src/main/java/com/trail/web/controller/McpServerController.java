package com.trail.web.controller;

import com.trail.llm.McpClientManager;
import com.trail.store.McpServerStore;
import com.trail.web.dto.McpServerDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/settings/mcp")
@Tag(name = "MCP 配置", description = "MCP Server 配置管理")
public class McpServerController {

    private final McpServerStore store;
    private final McpClientManager mcpClientManager;

    public McpServerController(McpServerStore store, McpClientManager mcpClientManager) {
        this.store = store;
        this.mcpClientManager = mcpClientManager;
    }

    @Operation(summary = "获取所有 MCP Server")
    @GetMapping
    public List<Map<String, Object>> list() {
        return store.findAll();
    }

    @Operation(summary = "新增 MCP Server")
    @PostMapping
    public Map<String, Object> create(@RequestBody McpServerDto dto) {
        Map<String, Object> row = store.save(
                dto.name(), dto.type(),
                dto.command(), dto.args(), dto.env(),
                dto.url(), dto.headers());
        mcpClientManager.refresh(String.valueOf(row.get("id")));
        return row;
    }

    @Operation(summary = "更新 MCP Server")
    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable String id, @RequestBody McpServerDto dto) {
        Map<String, Object> row = store.update(id,
                dto.name(), dto.type(),
                dto.command(), dto.args(), dto.env(),
                dto.url(), dto.headers(), dto.enabled());
        mcpClientManager.refresh(id);
        return row;
    }

    @Operation(summary = "删除 MCP Server")
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        store.delete(id);
        mcpClientManager.disconnect(id);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "测试 MCP Server 连通性，返回工具列表")
    @PostMapping("/{id}/test")
    public Map<String, Object> test(@PathVariable String id) {
        store.findById(id);
        return mcpClientManager.testConnection(id);
    }
}
