package com.trail.web.controller;

import com.trail.service.ReportExportService;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.LocalDate;

/**
 * 日报/周报导出 API
 * 用户点击下载链接后，实时生成 Markdown 文件
 */
@RestController
@RequestMapping("/api/reports")
public class ReportController {

    private final ReportExportService exportService;

    public ReportController(ReportExportService exportService) {
        this.exportService = exportService;
    }

    /**
     * 导出今日日报
     * GET /api/reports/daily?date=2025-01-15
     */
    @GetMapping("/daily")
    public ResponseEntity<Resource> exportDaily(
        @RequestParam(required = false) @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate date
    ) {
        if (date == null) {
            date = LocalDate.now();
        }

        String content = exportService.exportDaily(date);
        String filename = "daily_report_" + date + ".md";

        return downloadResponse(content, filename);
    }

    /**
     * 导出本周周报
     * GET /api/reports/weekly?start=2025-01-13&end=2025-01-19
     */
    @GetMapping("/weekly")
    public ResponseEntity<Resource> exportWeekly(
        @RequestParam(required = false) @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate start,
        @RequestParam(required = false) @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate end
    ) {
        if (start == null) {
            start = LocalDate.now().with(DayOfWeek.MONDAY);
        }
        if (end == null) {
            end = LocalDate.now();
        }

        String content = exportService.exportWeekly(start, end);
        String filename = String.format("weekly_report_%s_%s.md", start, end);

        return downloadResponse(content, filename);
    }

    /**
     * 构建 Markdown 文件下载响应
     */
    private ResponseEntity<Resource> downloadResponse(String content, String filename) {
        ByteArrayResource resource = new ByteArrayResource(
            content.getBytes(StandardCharsets.UTF_8)
        );

        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
            .contentType(MediaType.TEXT_MARKDOWN)
            .body(resource);
    }
}