package com.trail.web.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.trail.store.SkillStore;
import com.trail.web.dto.SkillDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/settings/skills")
@Tag(name = "Skills 配置", description = "聊天 Skill 提示词片段管理")
public class SkillController {

    private final SkillStore store;
    private final ObjectMapper mapper;

    public SkillController(SkillStore store, ObjectMapper mapper) {
        this.store = store;
        this.mapper = mapper;
    }

    @Operation(summary = "获取所有 Skills")
    @GetMapping
    public List<Map<String, Object>> list() {
        return store.findAll();
    }

    @Operation(summary = "新增 Skill")
    @PostMapping
    public Map<String, Object> create(@RequestBody SkillDto dto) {
        return store.save(dto.name(), dto.description(), dto.systemPrompt(),
                dto.sortOrder() != null ? dto.sortOrder() : 0,
                toScopeJson(dto.scope()));
    }

    @Operation(summary = "更新 Skill")
    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable String id, @RequestBody SkillDto dto) {
        return store.update(id, dto.name(), dto.description(), dto.systemPrompt(),
                dto.enabled(), dto.sortOrder(), toScopeJson(dto.scope()));
    }

    @Operation(summary = "删除 Skill")
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        store.delete(id);
        return ResponseEntity.noContent().build();
    }

    private String toScopeJson(List<String> scope) {
        if (scope == null || scope.isEmpty()) return null;
        try {
            return mapper.writeValueAsString(scope);
        } catch (Exception e) {
            return "[\"chat\"]";
        }
    }
}
