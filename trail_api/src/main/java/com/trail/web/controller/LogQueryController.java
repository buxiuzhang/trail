package com.trail.web.controller;

import com.trail.store.WorkLogStore;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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

    @Operation(summary = "按日期范围查询每日工时聚合", description = "返回范围内每天的工时合计，无日志的天补 0")
    @GetMapping("/by-date-range")
    public List<Map<String, Object>> byDateRange(
            @RequestParam(required = false) String start,
            @RequestParam(required = false) String end) {
        LocalDate endDate = (end != null && !end.isBlank()) ? LocalDate.parse(end) : LocalDate.now();
        LocalDate startDate = (start != null && !start.isBlank()) ? LocalDate.parse(start) : endDate.minusDays(13);

        List<Map<String, Object>> rows = workLogStore.getByDateRange(startDate, endDate);

        // 按日期聚合工时和日志数量
        Map<String, Double> byDay = new LinkedHashMap<>();
        Map<String, Integer> countByDay = new LinkedHashMap<>();
        for (LocalDate d = startDate; !d.isAfter(endDate); d = d.plusDays(1)) {
            byDay.put(d.toString(), 0.0);
            countByDay.put(d.toString(), 0);
        }
        for (Map<String, Object> row : rows) {
            String logDate = row.get("log_date").toString();
            double h = row.get("hours") != null ? ((Number) row.get("hours")).doubleValue() : 1.0;
            byDay.merge(logDate, h, Double::sum);
            countByDay.merge(logDate, 1, Integer::sum);
        }

        List<Map<String, Object>> result = new ArrayList<>();
        byDay.forEach((date2, hours) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("date", date2);
            m.put("hours", Math.round(hours * 10.0) / 10.0);
            m.put("count", countByDay.getOrDefault(date2, 0));
            result.add(m);
        });
        return result;
    }

    @Operation(summary = "任务日报热力图数据", description = "返回日期范围内每个任务每天的日报数量，用于热力图展示")
    @GetMapping("/heatmap")
    public List<Map<String, Object>> heatmap(
            @RequestParam(required = false) String start,
            @RequestParam(required = false) String end) {
        LocalDate endDate   = (end   != null && !end.isBlank())   ? LocalDate.parse(end)   : LocalDate.now();
        LocalDate startDate = (start != null && !start.isBlank()) ? LocalDate.parse(start) : endDate.minusDays(13);

        List<Map<String, Object>> rows = workLogStore.getByDateRange(startDate, endDate);

        record Key(long taskId, String date) {}
        Map<Key, int[]> countMap = new LinkedHashMap<>();
        Map<Long, String> titleMap = new LinkedHashMap<>();

        for (Map<String, Object> row : rows) {
            long taskId  = ((Number) row.get("task_id")).longValue();
            String date  = row.get("log_date").toString();
            String title = row.get("task_title") != null ? row.get("task_title").toString() : ("任务" + taskId);
            double h     = row.get("hours") != null ? ((Number) row.get("hours")).doubleValue() : 1.0;
            titleMap.putIfAbsent(taskId, title);
            Key k = new Key(taskId, date);
            countMap.computeIfAbsent(k, x -> new int[]{0, 0});
            countMap.get(k)[0]++;
            countMap.get(k)[1] += (int) Math.round(h * 10);
        }

        List<Map<String, Object>> result = new ArrayList<>();
        countMap.forEach((k, v) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("task_id",    k.taskId());
            m.put("task_title", titleMap.get(k.taskId()));
            m.put("date",       k.date());
            m.put("count",      v[0]);
            m.put("hours",      Math.round(v[1]) / 10.0);
            result.add(m);
        });
        result.sort((a, b) -> {
            int t = ((String) a.get("task_title")).compareTo((String) b.get("task_title"));
            return t != 0 ? t : ((String) a.get("date")).compareTo((String) b.get("date"));
        });
        return result;
    }
}
