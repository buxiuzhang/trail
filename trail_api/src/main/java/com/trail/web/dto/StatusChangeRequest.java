package com.trail.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

import java.time.LocalDate;

public record StatusChangeRequest(
        @NotBlank
        @Pattern(regexp = "未开始|进行中|已完成|已作废",
                 message = "status 必须是 未开始/进行中/已完成/已作废")
        String newStatus,
        LocalDate endDate,
        String summary,
        Boolean maintenance
) {}
