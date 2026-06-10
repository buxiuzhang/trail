package com.trail.web.dto;

import java.time.LocalDate;

public record StaleTaskResponse(
        Long id,
        String title,
        String status,
        String nature,
        LocalDate lastLogDate,
        Integer daysIdle
) {}
