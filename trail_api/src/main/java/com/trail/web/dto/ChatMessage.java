package com.trail.web.dto;

/** 聊天消息 */
public record ChatMessage(
    String role,  // "user" | "assistant"
    String content
) {}