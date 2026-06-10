package com.trail.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.List;

public record TaskCreateRequest(
        @NotBlank String title,
        String alias,
        // M10：含 ![](/api/attachments/N) 引用，每条约 40 字节，20k 可容 5–10 张图
        @Size(max = 20000) String description,
        LocalDate startDate,
        LocalDate processingDate,
        String status,
        String nature,
        List<String> tags,
        List<ContactDto> contacts
) {
    public TaskCreateRequest {
        if (status == null || status.isBlank()) status = "未开始";
        if (nature == null || nature.isBlank()) nature = "临时";
        if (tags == null) tags = List.of();
        if (contacts == null) contacts = List.of();
    }
}
