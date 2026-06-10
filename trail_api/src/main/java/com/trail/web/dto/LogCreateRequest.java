package com.trail.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;

public record LogCreateRequest(
        @NotNull LocalDate logDate,
        // M10：日志 content 也可含 ![](/api/attachments/N) 引用
        @NotBlank @Size(max = 10000) String content,
        @Pattern(regexp = "main|maintenance", message = "phase 必须是 main/maintenance")
        String phase
) {}
