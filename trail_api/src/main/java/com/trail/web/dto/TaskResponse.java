package com.trail.web.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** 任务对外响应。包含 lastLogDate（store 层 LEFT JOIN 派生）+ contacts 列表。 */
public record TaskResponse(
        Long id,
        String title,
        String alias,
        String description,
        LocalDate startDate,
        LocalDate processingDate,
        LocalDate endDate,
        String status,
        String nature,
        String summary,
        String maintenanceSummary,
        List<String> tags,
        String originalTitle,
        String source,
        Instant pinnedAt,
        Instant createdAt,
        Instant updatedAt,
        LocalDate lastLogDate,
        List<ContactDto> contacts
) {}
