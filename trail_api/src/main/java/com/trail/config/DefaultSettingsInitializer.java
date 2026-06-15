package com.trail.config;

import com.trail.config.AppProperties.Defaults;
import com.trail.store.LLMSettingsStore;
import com.trail.store.exception.DataDirNotConfiguredException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 启动时初始化默认配置到数据库。
 *
 * 从 AppProperties.defaults 读取默认值，加密后存入 llm_settings 表。
 * 只初始化数据库中不存在的配置项（幂等）。
 */
@Component
public class DefaultSettingsInitializer {
    private static final Logger log = LoggerFactory.getLogger(DefaultSettingsInitializer.class);

    private final AppProperties props;
    private final LLMSettingsStore store;
    private final DataDirService dataDirService;

    public DefaultSettingsInitializer(AppProperties props, LLMSettingsStore store, DataDirService dataDirService) {
        this.props = props;
        this.store = store;
        this.dataDirService = dataDirService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void initializeDefaults() {
        // 数据目录未配置时跳过
        if (!dataDirService.isConfigured()) {
            log.debug("数据目录未配置，跳过默认值初始化");
            return;
        }

        if (props == null || props.defaults() == null) {
            log.debug("未配置 trail.defaults，跳过初始化");
            return;
        }

        Defaults d = props.defaults();
        Map<String, String> defaults = new LinkedHashMap<>();
        // LLM 基础配置
        putIfPresent(defaults, "max_tokens", d.maxTokens());
        putIfPresent(defaults, "min_tokens", d.minTokens());
        putIfPresent(defaults, "auth_type", d.authType());
        putIfPresent(defaults, "speech_duration", d.speechDuration());
        // 座右铭
        putIfPresent(defaults, "motto", d.motto());
        // Placeholder 占位符
        putIfPresent(defaults, "placeholder_task_desc", d.placeholderTaskDesc());
        putIfPresent(defaults, "placeholder_log", d.placeholderLog());
        putIfPresent(defaults, "placeholder_todo_note", d.placeholderTodoNote());
        // Prompt 模板
        putIfPresent(defaults, "polish_system_prompt", d.polishSystemPrompt());
        putIfPresent(defaults, "polish_todo_system_prompt", d.polishTodoSystemPrompt());
        putIfPresent(defaults, "summarize_system_prompt", d.summarizeSystemPrompt());
        putIfPresent(defaults, "summarize_maintenance_prompt", d.summarizeMaintenancePrompt());
        putIfPresent(defaults, "ask_maintenance_prompt", d.askMaintenancePrompt());
        putIfPresent(defaults, "chat_system_prompt", d.chatSystemPrompt());
        putIfPresent(defaults, "tools_desc", d.toolsDesc());
        putIfPresent(defaults, "daily_report_template", d.dailyReportTemplate());
        putIfPresent(defaults, "weekly_report_template", d.weeklyReportTemplate());

        int initialized = 0;
        for (Map.Entry<String, String> e : defaults.entrySet()) {
            String key = e.getKey();
            String value = e.getValue();
            if (store.get(key) == null) {
                store.save(key, value);
                initialized++;
                log.info("初始化默认配置: {} ({} 字符)", key, value.length());
            }
        }

        if (initialized > 0) {
            log.info("默认配置初始化完成: {} 项", initialized);
        } else {
            log.debug("默认配置已存在，跳过初始化");
        }
    }

    private void putIfPresent(Map<String, String> map, String key, String value) {
        if (value != null && !value.isBlank()) {
            map.put(key, value);
        }
    }
}