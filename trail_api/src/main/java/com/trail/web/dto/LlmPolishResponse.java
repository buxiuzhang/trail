package com.trail.web.dto;

/** 润色响应 */
public record LlmPolishResponse(
    String polished,
    boolean mock
) {}