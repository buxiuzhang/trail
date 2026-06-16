package com.trail.web.dto;

import java.time.Instant;
import java.time.LocalDate;

public record LogResponse(
        Long id,
        Long taskId,
        LocalDate logDate,
        String phase,
        Integer ordinal,
        String content,
        String polishedContent,
        Double hours,  // M11：工时（小时）
        Boolean isDeleted,
        Instant deletedAt,
        Instant updatedAt,
        Integer editCount,
        Instant createdAt
) {}
