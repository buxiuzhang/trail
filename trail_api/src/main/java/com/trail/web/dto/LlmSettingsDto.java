package com.trail.web.dto;

/** LLM 配置响应。apiKey 解密后明文返回。 */
public record LlmSettingsDto(
        String apiKey,
        String baseUrl,
        String model,
        String maxTokens,
        String chatSystemPrompt,
        String toolsDesc
) {}
