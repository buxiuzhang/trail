package com.trail.web.dto;

import jakarta.validation.constraints.Size;

/** 全 Optional；至少一项非 null。 */
public record TodoUpdateRequest(
        @Size(max = 500) String title,
        @Size(max = 5000) String description
) {}
