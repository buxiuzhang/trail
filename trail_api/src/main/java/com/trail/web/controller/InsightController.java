package com.trail.web.controller;

import com.trail.store.InsightStore;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 统计与洞察
 */
@RestController
@RequestMapping("/api/insights")
@Tag(name = "统计洞察", description = "任务统计、闲置任务、近期活跃等数据概览")
public class InsightController {

    private final InsightStore insights;

    public InsightController(InsightStore insights) {
        this.insights = insights;
    }

    @Operation(summary = "任务统计概览", description = "返回任务总数、按状态分组计数、按性质分组计数等统计信息。")
    @GetMapping("/overview")
    public Map<String, Object> overview() {
        return insights.overview();
    }

    @Operation(summary = "闲置任务列表", description = "返回超过指定天数未更新日志的任务，默认 7 天。用于发现长期未推进的任务。")
    @GetMapping("/stale")
    public List<Map<String, Object>> stale(
            @Parameter(description = "闲置天数阈值，默认 7 天")
            @RequestParam(defaultValue = "7") int days) {
        return insights.staleTasks(days);
    }

    @Operation(summary = "近期活跃任务", description = "返回最近 N 天内有日志更新的任务，按活跃度排序。")
    @GetMapping("/recent")
    public List<Map<String, Object>> recent(
            @Parameter(description = "最近 N 天，默认 7 天")
            @RequestParam(defaultValue = "7") int days) {
        return insights.recentTasks(days);
    }

    @Operation(summary = "今日待办统计", description = "返回今日新增待办数和今日跟进待办数。")
    @GetMapping("/todo-stats")
    public Map<String, Object> todoStats() {
        return insights.todayTodoStats();
    }
}
