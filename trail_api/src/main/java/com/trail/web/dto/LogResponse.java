package com.trail.web.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record LogResponse(
        Long id,
        Long taskId,
        LocalDate logDate,
        String phase,
        Integer ordinal,
        String content,
        String polishedContent,
        Double hours,
        Boolean isDeleted,
        Instant deletedAt,
        Instant updatedAt,
        Integer editCount,
        Instant createdAt,
        List<Long> todoIds,
        List<Long> taskIds,
        List<Long> attachmentIds
) {}
