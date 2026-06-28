package com.trail.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.trail.store.ReportTemplateStore;
import com.trail.store.WorkLogStore;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class ReportExportService {

    private final WorkLogStore workLogStore;
    private final ReportTemplateStore reportTemplateStore;
    private final LlmService llmService;
    private final ObjectMapper mapper;

    private static final DateTimeFormatter DATE_CN_FORMAT = DateTimeFormatter.ofPattern("yyyy年M月d日");

    public ReportExportService(
        WorkLogStore workLogStore,
        ReportTemplateStore reportTemplateStore,
        LlmService llmService,
        ObjectMapper mapper
    ) {
        this.workLogStore = workLogStore;
        this.reportTemplateStore = reportTemplateStore;
        this.llmService = llmService;
        this.mapper = mapper;
    }

    /**
     * 用自定义模板导出报表
     */
    public String exportCustom(String templateId, LocalDate start, LocalDate end) {
        Map<String, Object> tpl = reportTemplateStore.findById(templateId);
        String templateName = (String) tpl.get("name");
        String template = (String) tpl.get("template");
        if (template == null || template.isBlank()) {
            throw new com.trail.store.exception.StoreError(
                "模板「" + templateName + "」内容为空，请先在「设置 → 大模型 → 导出模板」中填写模板格式后再导出。");
        }

        List<Map<String, Object>> logs = start.equals(end)
            ? workLogStore.getByDate(start)
            : workLogStore.getByDateRange(start, end);

        String logsJson = buildLogsJson(logs);

        String timeRange = start.equals(end)
            ? start.format(DATE_CN_FORMAT)
            : start.format(DATE_CN_FORMAT) + " 至 " + end.format(DATE_CN_FORMAT);

        String prompt = """
            根据以下模板格式和工作日志数据，生成「%s」的 Markdown 内容。

            模板格式：
            %s

            工作日志数据（JSON）：
            %s

            时间范围：%s

            要求：
            1. 严格遵循模板的结构和格式
            2. 用实际日志数据填充内容，不要编造
            3. 按日期或任务合理组织内容
            4. 如果没有日志，如实说明
            5. 保持专业、简洁的文风
            6. 只输出最终的 Markdown 内容，不要解释或包裹
            """.formatted(templateName, template, logsJson, timeRange);

        return llmService.chat(prompt);
    }

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
