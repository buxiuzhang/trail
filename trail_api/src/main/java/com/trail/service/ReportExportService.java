package com.trail.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.trail.store.LLMSettingsStore;
import com.trail.store.WorkLogStore;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 日报/周报导出服务
 * 根据模板和日志数据生成 Markdown 内容
 *
 * 默认模板在 application.yml 的 trail.defaults 配置，
 * 启动时由 DefaultSettingsInitializer 初始化到数据库。
 */
@Service
public class ReportExportService {

    private final WorkLogStore workLogStore;
    private final LLMSettingsStore llmSettingsStore;
    private final LlmService llmService;
    private final ObjectMapper mapper;

    private static final DateTimeFormatter DATE_CN_FORMAT = DateTimeFormatter.ofPattern("yyyy年M月d日");

    public ReportExportService(
        WorkLogStore workLogStore,
        LLMSettingsStore llmSettingsStore,
        LlmService llmService,
        ObjectMapper mapper
    ) {
        this.workLogStore = workLogStore;
        this.llmSettingsStore = llmSettingsStore;
        this.llmService = llmService;
        this.mapper = mapper;
    }

    /**
     * 导出今日日报
     */
    public String exportDaily(LocalDate date) {
        // 1. 查询当日日志
        List<Map<String, Object>> logs = workLogStore.getByDate(date);

        // 2. 获取模板（从数据库读取）
        String template = llmSettingsStore.get("daily_report_template");
        if (template == null || template.isBlank()) {
            template = "";
        }

        // 3. 构建数据 JSON
        String logsJson = buildLogsJson(logs);

        // 4. 调用 LLM 生成内容
        String prompt = """
            根据以下模板格式和工作日志数据，生成日报 Markdown 内容。

            模板格式：
            %s

            工作日志数据（JSON）：
            %s

            日期：%s（%s）

            要求：
            1. 严格遵循模板的结构和格式
            2. 用实际日志数据填充内容，不要编造
            3. 如果某天没有日志，如实说明"无工作记录"
            4. 保持专业、简洁的文风
            5. 只输出最终的 Markdown 内容，不要解释或包裹
            """.formatted(template, logsJson, date, date.format(DATE_CN_FORMAT));

        return llmService.chat(prompt);
    }

    /**
     * 导出本周周报
     */
    public String exportWeekly(LocalDate start, LocalDate end) {
        // 1. 查询日期范围内日志
        List<Map<String, Object>> logs = workLogStore.getByDateRange(start, end);

        // 2. 获取模板（从数据库读取）
        String template = llmSettingsStore.get("weekly_report_template");
        if (template == null || template.isBlank()) {
            template = "";
        }

        // 3. 构建数据 JSON
        String logsJson = buildLogsJson(logs);

        // 4. 调用 LLM 生成内容
        String prompt = """
            根据以下模板格式和工作日志数据，生成周报 Markdown 内容。

            模板格式：
            %s

            工作日志数据（JSON）：
            %s

            时间范围：%s 至 %s

            要求：
            1. 严格遵循模板的结构和格式
            2. 用实际日志数据填充内容，不要编造
            3. 按日期或任务合理组织内容
            4. 如果某天没有日志，如实说明
            5. 保持专业、简洁的文风
            6. 只输出最终的 Markdown 内容，不要解释或包裹
            """.formatted(template, logsJson,
                start.format(DATE_CN_FORMAT), end.format(DATE_CN_FORMAT));

        return llmService.chat(prompt);
    }

    /**
     * 构建日志数据的 JSON 字符串
     */
    private String buildLogsJson(List<Map<String, Object>> logs) {
        try {
            List<Map<String, Object>> enriched = workLogStore.enrichLogs(logs);
            List<Map<String, Object>> simplified = enriched.stream()
                .map(log -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("log_date", log.get("log_date"));
                    item.put("task_title", log.get("task_title"));
                    item.put("phase", log.get("phase"));
                    item.put("hours", log.getOrDefault("hours", 1.0));
                    item.put("content", log.get("content"));
                    if (log.containsKey("related_todos")) item.put("related_todos", log.get("related_todos"));
                    if (log.containsKey("related_tasks")) item.put("related_tasks", log.get("related_tasks"));
                    return item;
                })
                .collect(Collectors.toList());
            return mapper.writeValueAsString(simplified);
        } catch (Exception e) {
            return "[]";
        }
    }
}