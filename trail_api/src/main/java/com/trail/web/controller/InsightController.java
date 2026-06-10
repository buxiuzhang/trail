package com.trail.web.controller;

import com.trail.store.InsightStore;
import com.trail.web.dto.OverviewResponse;
import com.trail.web.dto.StaleTaskResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/insights")
public class InsightController {

    private final InsightStore store;

    public InsightController(InsightStore store) {
        this.store = store;
    }

    @GetMapping("/overview")
    public OverviewResponse overview() {
        var o = store.overview();
        @SuppressWarnings("unchecked")
        Map<String, Integer> byStatus = (Map<String, Integer>) o.getOrDefault("by_status", new HashMap<>());
        @SuppressWarnings("unchecked")
        Map<String, Integer> byNature = (Map<String, Integer>) o.getOrDefault("by_nature", new HashMap<>());
        return new OverviewResponse(
                (int) o.getOrDefault("total_tasks", 0),
                byStatus,
                byNature,
                (int) o.getOrDefault("total_logs", 0)
        );
    }

    @GetMapping("/stale")
    public List<StaleTaskResponse> stale(@RequestParam(defaultValue = "30") int idleDays) {
        return store.staleTasks(idleDays).stream().map(r -> new StaleTaskResponse(
                ((Number) r.get("id")).longValue(),
                (String) r.get("title"),
                (String) r.get("status"),
                (String) r.get("nature"),
                toLocalDate(r.get("last_log_date")),
                r.get("days_idle") == null ? null : ((Number) r.get("days_idle")).intValue()
        )).toList();
    }

    private static java.time.LocalDate toLocalDate(Object o) {
        if (o == null) return null;
        if (o instanceof java.time.LocalDate ld) return ld;
        if (o instanceof java.sql.Date d) return d.toLocalDate();
        String s = o.toString();
        try { return java.time.LocalDate.parse(s); }
        catch (java.time.format.DateTimeParseException ignored) {}
        try { return java.time.LocalDate.parse(s.length() >= 10 ? s.substring(0, 10) : s); }
        catch (java.time.format.DateTimeParseException ignored) {}
        return null;
    }
}
