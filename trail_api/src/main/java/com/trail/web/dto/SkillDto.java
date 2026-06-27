package com.trail.web.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/** Skill 配置 DTO（request + response 共用）。 */
public record SkillDto(
        String id,
        @NotBlank String name,
        String description,
        @NotBlank String systemPrompt,
        Boolean enabled,
        Integer sortOrder,
        List<String> scope,
        String injectionMode,
        String createdAt
) {}
