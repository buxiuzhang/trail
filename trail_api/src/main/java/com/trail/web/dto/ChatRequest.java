package com.trail.web.dto;

import java.util.List;

/** 聊天请求 */
public record ChatRequest(
    List<ChatMessage> messages
) {}