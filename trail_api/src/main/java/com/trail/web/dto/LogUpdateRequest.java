package com.trail.web.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;

/** 全 Optional；至少一项非 null。 */
public record LogUpdateRequest(
        // M10：日志 content 也可含 ![](/api/attachments/N) 引用
        @Size(max = 10000) String content,
        LocalDate logDate,
        @Pattern(regexp = "main|maintenance") String phase
) {}
