package com.trail.web.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.List;

public record LogCreateRequest(
        @NotNull LocalDate logDate,
        // M10：日志 content 也可含 ![](/api/attachments/N) 引用
        @NotBlank @Size(max = 10000) String content,
        @Pattern(regexp = "main|maintenance", message = "phase 必须是 main/maintenance")
        String phase,
        // M11：工时（小时），可选，默认 1.0
        @DecimalMin(value = "0.0", inclusive = false, message = "工时必须大于 0")
        @DecimalMax(value = "12.0", inclusive = false, message = "工时必须小于 12")
        Double hours,
        // M12：关联待办 ID 列表
        List<Long> todoIds,
        // 关联任务 ID 列表
        List<Long> taskIds
) {}
