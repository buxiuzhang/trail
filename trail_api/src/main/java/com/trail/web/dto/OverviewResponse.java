package com.trail.web.dto;

import java.util.Map;

public record OverviewResponse(
        int totalTasks,
        Map<String, Integer> byStatus,
        Map<String, Integer> byNature,
        int totalLogs
) {}
