package com.trail.web.dto;

/**
 * LLM 配置响应。
 *
 * - apiKeyMasked: 遮蔽值（格式：前4位****后4位）
 * - apiKeyEncrypted: RSA 加密后的完整值（前端请求解密端点显示明文）
 */
public record LlmSettingsDto(
        String apiKeyMasked,
        String apiKeyEncrypted,
        String baseUrl,
        String model,
        String maxTokens,
        String minTokens,
        String authType,
        // Prompt 模板
        String chatSystemPrompt,
        String polishSystemPrompt,
        String polishTodoSystemPrompt,
        String polishTaskDescSystemPrompt,
        String summarizeSystemPrompt,
        String summarizeMaintenancePrompt,
        String askMaintenancePrompt,
        String draftLogSystemPrompt,
        // 日报/周报模板
        String dailyReportTemplate,
        String weeklyReportTemplate,
        // AI 标注提示词
        String batchTagSystemPrompt,
        // 语音输入时长（秒）
        String speechDuration,
        // 工具调用最大迭代次数
        String maxToolIterations,
        // 特别关注
        String watchIdleHotDays,
        String watchIdleWarnDays,
        String watchSnoozeMinutes,
        String watchCron,
        // 待办事项超期预警
        String todoIdleWarnDays,
        String todoCron,
        // 推送消息模板
        String watchAlertTemplate,
        String todoAlertTemplate
) {}