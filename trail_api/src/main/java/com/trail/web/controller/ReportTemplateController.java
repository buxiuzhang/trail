package com.trail.web.controller;

import com.trail.service.ReportExportService;
import com.trail.store.ReportTemplateStore;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/settings/report-templates")
@Tag(name = "导出模板", description = "用户自定义报表模板的增删改查与导出")
public class ReportTemplateController {

    private final ReportTemplateStore store;
    private final ReportExportService exportService;

    public ReportTemplateController(ReportTemplateStore store, ReportExportService exportService) {
        this.store = store;
        this.exportService = exportService;
    }

    @Operation(summary = "获取所有导出模板")
    @GetMapping
    public List<Map<String, Object>> list() {
        return store.findAll();
    }

    @Operation(summary = "新建导出模板")
    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        String name = (String) body.get("name");
        if (name == null || name.isBlank()) throw new IllegalArgumentException("模板名称不能为空");
        String template = (String) body.get("template");
        if (template == null || template.isBlank()) throw new IllegalArgumentException("模板内容不能为空");
        String description = (String) body.get("description");
        int sortOrder = body.containsKey("sort_order") ? ((Number) body.get("sort_order")).intValue() : 0;
        return store.save(name.trim(), description != null ? description.trim() : null, template.trim(), sortOrder);
    }

    @Operation(summary = "更新导出模板")
    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable String id, @RequestBody Map<String, Object> body) {
        String name = body.containsKey("name") ? ((String) body.get("name")) : null;
        String description = body.containsKey("description") ? ((String) body.get("description")) : null;
        String template = body.containsKey("template") ? ((String) body.get("template")) : null;
        Boolean enabled = body.containsKey("enabled") ? ((Number) body.get("enabled")).intValue() == 1 : null;
        Integer sortOrder = body.containsKey("sort_order") ? ((Number) body.get("sort_order")).intValue() : null;
        return store.update(id,
            name != null ? name.trim() : null,
            description,
            template != null ? template.trim() : null,
            enabled, sortOrder);
    }

    @Operation(summary = "删除导出模板")
    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable String id) {
        store.delete(id);
        return Map.of("ok", true);
    }

    @Operation(summary = "用自定义模板导出报表")
    @GetMapping("/{id}/export")
    public ResponseEntity<Resource> export(
        @PathVariable String id,
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate start,
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate end
    ) {
        String content = exportService.exportCustom(id, start, end);
        Map<String, Object> tpl = store.findById(id);
        String safeName = ((String) tpl.get("name")).replaceAll("[^\\w\\u4e00-\\u9fa5-]", "_");
        String filename = safeName + "_" + start + (start.equals(end) ? "" : "_" + end) + ".md";

        ByteArrayResource resource = new ByteArrayResource(content.getBytes(StandardCharsets.UTF_8));
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" +
                java.net.URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20"))
            .contentType(MediaType.TEXT_MARKDOWN)
            .body(resource);
    }
}
