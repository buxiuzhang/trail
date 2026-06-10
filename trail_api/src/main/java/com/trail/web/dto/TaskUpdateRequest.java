package com.trail.web.dto;

import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.List;

/** 全部 Optional；null 表示不改。 */
public record TaskUpdateRequest(
        String title,
        String alias,
        // M10：含 ![](/api/attachments/N) 引用
        @Size(max = 20000) String description,
        LocalDate startDate,
        LocalDate processingDate,
        LocalDate endDate,
        String nature,
        String summary,
        String maintenanceSummary,
        List<String> tags,
        List<ContactDto> contacts,
        String status
) {}
