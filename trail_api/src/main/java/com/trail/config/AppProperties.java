package com.trail.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * trail.* 配置绑定。
 *
 * @param dataDir     数据目录路径
 * @param crypto      加密相关配置
 * @param llm         LLM 相关配置
 * @param attachment  附件相关配置
 * @param defaults    默认值配置（启动时初始化到数据库）
 */
@ConfigurationProperties(prefix = "trail")
public record AppProperties(
        String dataDir,
        Crypto crypto,
        Llm llm,
        Attachment attachment,
        Defaults defaults
) {
    public record Crypto(String salt, Integer iterations) {
        public int getIterations() {
            return iterations != null ? iterations : 480_000;
        }
    }

    public record Llm(String defaultModel, String defaultBaseUrl, Integer maxToolIterations) {
        public String getDefaultModel() {
            return defaultModel != null ? defaultModel : "claude-haiku-4-5";
        }
        public String getDefaultBaseUrl() {
            return defaultBaseUrl != null ? defaultBaseUrl : "https://api.anthropic.com";
        }
        public int getMaxToolIterations() {
            return maxToolIterations != null ? maxToolIterations : 10;
        }
    }

    public record Attachment(Long maxBytes) {
        public long getMaxBytes() {
            return maxBytes != null ? maxBytes : 10_485_760L; // 10MB
        }
    }

    public record Defaults(
            String maxTokens,
            String minTokens,
            String authType,
            String speechDuration,
            String todoIdleWarnDays,
            String todoCron,
            String watchAlertTemplate,
            String todoAlertTemplate,
            String motto,
            String placeholderTaskDesc,
            String placeholderLog,
            String placeholderTodoNote,
            String polishSystemPrompt,
            String polishTodoSystemPrompt,
            String polishTaskDescSystemPrompt,
            String summarizeSystemPrompt,
            String summarizeMaintenancePrompt,
            String askMaintenancePrompt,
            String chatSystemPrompt,
            String dailyReportTemplate,
            String weeklyReportTemplate,
            String batchTagSystemPrompt
    ) {}
}