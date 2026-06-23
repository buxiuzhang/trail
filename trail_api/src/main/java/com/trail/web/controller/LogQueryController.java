package com.trail.web.controller;

import com.trail.store.WorkLogStore;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/logs")
@Tag(name = "日志查询", description = "跨任务日志查询")
public class LogQueryController {

    private final WorkLogStore workLogStore;

    public LogQueryController(WorkLogStore workLogStore) {
        this.workLogStore = workLogStore;
    }

    @Operation(summary = "按日期查询所有日志", description = "不传 date 默认今天")
    @GetMapping("/by-date")
    public List<Map<String, Object>> byDate(
            @RequestParam(required = false) String date) {
        LocalDate d = (date != null && !date.isBlank()) ? LocalDate.parse(date) : LocalDate.now();
        return workLogStore.getByDate(d);
    }
}
