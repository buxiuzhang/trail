package com.trail.web.dto;

/** 润色请求 */
public record LlmPolishRequest(
    String content,
    Long task_id,
    String type  // "log" | "todo"，默认 "log"
) {}