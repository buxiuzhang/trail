package com.trail.web.dto;

/** LLM 配置响应。apiKey 解密后明文返回。 */
public record LlmSettingsDto(
        String apiKey,
        String baseUrl,
        String model,
        String maxTokens,
        // Prompt 模板
        String chatSystemPrompt,
        String polishSystemPrompt,
        String polishTodoSystemPrompt,
        String summarizeSystemPrompt,
        String summarizeMaintenancePrompt,
        String askMaintenancePrompt,
        String toolsDesc
) {}
