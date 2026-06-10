package com.trail.web.dto;

import java.time.Instant;

public record TodoResponse(
        Long id,
        Long taskId,
        String title,
        String description,
        Boolean isCompleted,
        Boolean isAbandoned,
        Instant createdAt,
        Instant updatedAt
) {}
