package com.trail.web.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.List;

/** 全 Optional；至少一项非 null。 */
public record LogUpdateRequest(
        // M10：日志 content 也可含 ![](/api/attachments/N) 引用
        @Size(max = 10000) String content,
        LocalDate logDate,
        @Pattern(regexp = "main|maintenance") String phase,
        // M11：工时（小时），可选
        @DecimalMin(value = "0.0", inclusive = false, message = "工时必须大于 0")
        @DecimalMax(value = "12.0", inclusive = false, message = "工时必须小于 12")
        Double hours,
        // M12：关联待办 ID 列表（null = 不改，空列表 = 清空关联）
        List<Long> todoIds,
        // 关联任务 ID 列表（null = 不改，空列表 = 清空关联）
        List<Long> taskIds
) {}
