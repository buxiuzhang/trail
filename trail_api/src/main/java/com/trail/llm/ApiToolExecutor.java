package com.trail.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.trail.db.SqliteDb;
import com.trail.service.EmbeddingService;
import com.trail.store.ReportTemplateStore;
import com.trail.store.SkillStore;
import com.trail.store.VectorStore;
import com.trail.store.WorkLogStore;
import com.trail.store.exception.NotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * API 工具执行器
 * 执行 get_api_docs、call_api、export_daily_report、export_weekly_report 工具
 */
@Component
public class ApiToolExecutor {

    private static final Logger log = LoggerFactory.getLogger(ApiToolExecutor.class);

    private final OpenApiService openApiService;
    private final SqliteDb db;
    private final ObjectMapper mapper;
    private final HttpClient client;
    private final WorkLogStore workLogStore;
    private final McpClientManager mcpClientManager;
    private final EmbeddingService embeddingService;
    private final VectorStore vectorStore;
    private final SkillStore skillStore;
    private final ReportTemplateStore reportTemplateStore;

    public ApiToolExecutor(OpenApiService openApiService, SqliteDb db, ObjectMapper mapper,
                           WorkLogStore workLogStore, McpClientManager mcpClientManager,
                           EmbeddingService embeddingService, VectorStore vectorStore,
                           SkillStore skillStore, ReportTemplateStore reportTemplateStore) {
        this.openApiService = openApiService;
        this.db = db;
        this.mapper = mapper;
        this.client = HttpClient.newHttpClient();
        this.workLogStore = workLogStore;
        this.mcpClientManager = mcpClientManager;
        this.embeddingService = embeddingService;
        this.vectorStore = vectorStore;
        this.skillStore = skillStore;
        this.reportTemplateStore = reportTemplateStore;
    }

    /**
     * 执行工具调用
     */
    public String execute(String name, Map<String, Object> input) {
        try {
            Object result = switch (name) {
                case "list_controllers" -> executeListControllers();
                case "list_endpoints" -> executeListEndpoints(input);
                case "get_api_docs" -> executeGetApiDocs(input);
                case "get_logs_by_date" -> executeGetLogsByDate(input);
                case "call_api" -> executeCallApi(input);
                case "list_report_templates" -> executeListReportTemplates();
                case "export_report" -> executeExportReport(input);
                case "vector_search" -> executeVectorSearch(input);
                case "get_skill_detail" -> executeGetSkillDetail(input);
                default -> {
                    if (name.startsWith("mcp__")) {
                        yield mcpClientManager.callTool(name, input);
                    }
                    throw new IllegalArgumentException("未知工具：" + name);
                }
            };
            return toJson(result);
        } catch (Exception e) {
            log.error("Tool {} execution failed", name, e);
            return toJson(Map.of("error", "工具执行失败：" + e.getMessage()));
        }
    }

    // ============================================================
    // list_controllers 执行
    // ============================================================

    private Map<String, Object> executeListControllers() {
        List<OpenApiService.ControllerInfo> controllers = openApiService.listControllers();
        if (controllers.isEmpty()) {
            return Map.of("error", "无法获取模块列表，请检查 API 文档是否加载");
        }

        List<Map<String, Object>> list = controllers.stream()
            .map(c -> {
                Map<String, Object> m = new HashMap<>();
                m.put("name", c.name());
                m.put("description", c.description());
                m.put("path_prefix", c.pathPrefix());
                m.put("endpoints", c.endpoints());
                return m;
            })
            .toList();

        return Map.of(
            "controllers", list,
            "count", list.size(),
            "hint", "选择一个模块，使用 list_endpoints 查看具体接口"
        );
    }

    // ============================================================
    // list_endpoints 执行
    // ============================================================

    private Map<String, Object> executeListEndpoints(Map<String, Object> input) {
        String controller = (String) input.get("controller");
        if (controller == null || controller.isBlank()) {
            return Map.of("error", "controller 参数必填，请先使用 list_controllers 查看可用模块");
        }

        List<OpenApiService.EndpointInfo> endpoints = openApiService.listEndpoints(controller);
        if (endpoints.isEmpty()) {
            return Map.of(
                "error", "未找到模块：" + controller,
                "hint", "请使用 list_controllers 查看正确的模块名称"
            );
        }

        List<Map<String, Object>> list = endpoints.stream()
            .map(e -> {
                Map<String, Object> m = new HashMap<>();
                m.put("method", e.method());
                m.put("path", e.path());
                m.put("summary", e.summary());
                return m;
            })
            .toList();

        return Map.of(
            "controller", controller,
            "endpoints", list,
            "count", list.size(),
            "hint", "选择一个接口，使用 get_api_docs(path=...) 查看参数详情"
        );
    }

    // ============================================================
    // get_api_docs 执行
    // ============================================================

    private Map<String, Object> executeGetApiDocs(Map<String, Object> input) {
        String search = (String) input.get("search");
        String path = (String) input.get("path");

        if (path != null && !path.isBlank()) {
            // 查询具体 API 详情
            OpenApiService.ApiInfo info = openApiService.getApiDetail(path);
            if (info == null) {
                return Map.of("error", "未找到 API：" + path);
            }
            return Map.of(
                "api", info,
                "markdown", info.toMarkdown()
            );
        }

        // 搜索 API
        List<OpenApiService.ApiInfo> results = openApiService.searchApiDocs(search);
        if (results.isEmpty()) {
            return Map.of(
                "message", "未找到匹配的 API",
                "suggestion", "可尝试使用其他关键词搜索，如'查询'、'添加'、'任务'、'日志'"
            );
        }

        // 返回搜索结果（最多 10 个）
        List<Map<String, Object>> apis = results.stream()
            .limit(10)
            .map(info -> {
                Map<String, Object> m = new HashMap<>();
                m.put("method", info.method());
                m.put("path", info.path());
                m.put("summary", info.summary());
                m.put("tag", info.tag());
                return m;
            })
            .toList();

        return Map.of(
            "apis", apis,
            "count", apis.size(),
            "hint", apis.size() > 1
                ? "找到多个匹配的 API，请确认您要操作的是哪一个"
                : "找到匹配的 API"
        );
    }

    // ============================================================
    // get_logs_by_date 执行
    // ============================================================

    private Map<String, Object> executeGetLogsByDate(Map<String, Object> input) {
        String dateStr = (String) input.get("date");
        String startStr = (String) input.get("start_date");
        String endStr = (String) input.get("end_date");

        LocalDate today = LocalDate.now();
        LocalDate start;
        LocalDate end;

        if (dateStr != null && !dateStr.isBlank()) {
            LocalDate d = switch (dateStr.toLowerCase()) {
                case "today", "今天" -> today;
                case "yesterday", "昨天" -> today.minusDays(1);
                default -> LocalDate.parse(dateStr);
            };
            start = d;
            end = d;
        } else if (startStr != null && !startStr.isBlank()) {
            start = LocalDate.parse(startStr);
            end = (endStr != null && !endStr.isBlank()) ? LocalDate.parse(endStr) : today;
        } else {
            start = today;
            end = today;
        }

        List<Map<String, Object>> rows = start.equals(end)
            ? workLogStore.getByDate(start)
            : workLogStore.getByDateRange(start, end);
        rows = workLogStore.enrichLogs(rows);

        if (rows.isEmpty()) {
            return Map.of(
                "start_date", start.toString(),
                "end_date", end.toString(),
                "total_hours", 0.0,
                "task_count", 0,
                "log_count", 0,
                "days", List.of(),
                "message", "该时间段内没有工作日志记录"
            );
        }

        // 按日期 → task_id 两级聚合，TreeMap 保证日期有序
        TreeMap<String, Map<Long, Map<String, Object>>> byDate = new TreeMap<>();
        for (Map<String, Object> row : rows) {
            String logDate = row.get("log_date").toString();
            long taskId = ((Number) row.get("task_id")).longValue();

            byDate.computeIfAbsent(logDate, k -> new LinkedHashMap<>())
                  .computeIfAbsent(taskId, k -> {
                      Map<String, Object> t = new LinkedHashMap<>();
                      t.put("task_id", taskId);
                      t.put("title", row.get("task_title"));
                      t.put("status", row.get("status"));
                      t.put("task_hours", 0.0);
                      t.put("logs", new ArrayList<>());
                      return t;
                  });

            Map<String, Object> taskEntry = byDate.get(logDate).get(taskId);
            double h = row.get("hours") != null ? ((Number) row.get("hours")).doubleValue() : 1.0;
            taskEntry.put("task_hours", (double) taskEntry.get("task_hours") + h);

            Map<String, Object> logEntry = new LinkedHashMap<>();
            logEntry.put("log_id", row.get("id"));
            logEntry.put("hours", h);
            Object polished = row.get("polished_content");
            logEntry.put("content", (polished != null && !polished.toString().isBlank())
                ? polished : row.get("content"));
            if (row.containsKey("related_todos")) logEntry.put("related_todos", row.get("related_todos"));
            if (row.containsKey("related_tasks")) logEntry.put("related_tasks", row.get("related_tasks"));
            ((List<Map<String, Object>>) taskEntry.get("logs")).add(logEntry);
        }

        // 构建 days 列表
        List<Map<String, Object>> days = new ArrayList<>();
        double totalHours = 0.0;
        int totalTasks = 0;

        for (Map.Entry<String, Map<Long, Map<String, Object>>> dayEntry : byDate.entrySet()) {
            double dayHours = 0.0;
            List<Map<String, Object>> taskList = new ArrayList<>(dayEntry.getValue().values());
            for (Map<String, Object> t : taskList) {
                dayHours += (double) t.get("task_hours");
            }
            Map<String, Object> dayMap = new LinkedHashMap<>();
            dayMap.put("date", dayEntry.getKey());
            dayMap.put("day_hours", dayHours);
            dayMap.put("tasks", taskList);
            days.add(dayMap);
            totalHours += dayHours;
            totalTasks += taskList.size();
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("start_date", start.toString());
        result.put("end_date", end.toString());
        result.put("total_hours", totalHours);
        result.put("task_count", totalTasks);
        result.put("log_count", rows.size());
        result.put("days", days);
        return result;
    }

    // ============================================================
    // call_api 执行
    // ============================================================

    private Map<String, Object> executeCallApi(Map<String, Object> input) {
        String method = (String) input.get("method");
        String path = (String) input.get("path");
        Boolean confirmed = (Boolean) input.get("confirmed");

        if (method == null || method.isBlank()) {
            return Map.of("error", "method 参数必填");
        }
        if (path == null || path.isBlank()) {
            return Map.of("error", "path 参数必填");
        }

        method = method.toUpperCase();

        // 检查是否禁止
        if ("DELETE".equals(method) || openApiService.isForbidden(path)) {
            return Map.of("error", "此操作禁止执行：" + method + " " + path);
        }

        // 检查是否需要确认
        if (openApiService.needsConfirmation(method) && !Boolean.TRUE.equals(confirmed)) {
            return Map.of(
                "need_confirm", true,
                "message", "此操作需要用户确认后才能执行",
                "operation", method + " " + path,
                "hint", "请向用户展示操作内容，用户确认后再带上 confirmed=true 参数调用"
            );
        }

        // 执行 API 调用
        try {
            Map<String, Object> queryParams = (Map<String, Object>) input.get("query_params");
            Map<String, Object> body = (Map<String, Object>) input.get("body");

            // 构建完整 URL
            String url = "http://127.0.0.1:8765" + path;
            if (queryParams != null && !queryParams.isEmpty()) {
                StringBuilder qs = new StringBuilder();
                queryParams.forEach((k, v) -> {
                    if (qs.length() > 0) qs.append("&");
                    qs.append(k).append("=").append(v);
                });
                url += "?" + qs;
            }

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json");

            if ("GET".equals(method)) {
                reqBuilder.GET();
            } else if ("POST".equals(method)) {
                if (body != null) {
                    reqBuilder.POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
                } else {
                    reqBuilder.POST(HttpRequest.BodyPublishers.ofString("{}"));
                }
            } else if ("PUT".equals(method)) {
                if (body != null) {
                    reqBuilder.PUT(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
                } else {
                    reqBuilder.PUT(HttpRequest.BodyPublishers.ofString("{}"));
                }
            }

            HttpRequest req = reqBuilder.build();
            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());

            if (resp.statusCode() >= 400) {
                return Map.of(
                    "error", "API 返回错误：" + resp.statusCode(),
                    "detail", resp.body()
                );
            }

            // 解析响应
            Object responseBody = mapper.readValue(resp.body(), Object.class);
            return Map.of(
                "success", true,
                "status", resp.statusCode(),
                "data", responseBody
            );

        } catch (Exception e) {
            log.error("API call failed: {} {}", method, path, e);
            return Map.of("error", "API 调用失败：" + e.getMessage());
        }
    }

    // ============================================================
    // 列出导出模板
    // ============================================================

    private List<Map<String, Object>> executeListReportTemplates() {
        return reportTemplateStore.findAllEnabled().stream()
            .map(t -> {
                Map<String, Object> m = new java.util.LinkedHashMap<>();
                m.put("id", t.get("id"));
                m.put("name", t.get("name"));
                m.put("description", t.get("description"));
                return m;
            })
            .toList();
    }

    // ============================================================
    // 导出报表
    // ============================================================

    private Map<String, Object> executeExportReport(Map<String, Object> input) {
        String templateId = (String) input.get("template_id");
        if (templateId == null || templateId.isBlank()) {
            return Map.of("error", "template_id 必填，请先调用 list_report_templates 查询可用模板");
        }

        // 验证模板存在
        Map<String, Object> tpl;
        try {
            tpl = reportTemplateStore.findById(templateId);
        } catch (com.trail.store.exception.NotFoundException e) {
            return Map.of("error", "模板不存在，请先调用 list_report_templates 查询正确的模板 ID");
        }

        String startStr = (String) input.get("start_date");
        String endStr = (String) input.get("end_date");

        LocalDate start = (startStr != null && !startStr.isBlank())
            ? LocalDate.parse(startStr)
            : LocalDate.now().with(DayOfWeek.MONDAY);

        LocalDate end = (endStr != null && !endStr.isBlank())
            ? LocalDate.parse(endStr)
            : LocalDate.now();

        String templateName = (String) tpl.get("name");
        String url = String.format("/api/settings/report-templates/%s/export?start=%s&end=%s",
            templateId, start, end);

        return Map.of(
            "message", String.format("「%s」已生成，点击下载：[%s_%s_%s.md](%s)",
                templateName, templateName, start, end, url)
        );
    }


    // ============================================================
    // vector_search 执行
    // ============================================================

    private Map<String, Object> executeVectorSearch(Map<String, Object> input) {
        String query = (String) input.get("query");
        if (query == null || query.isBlank()) {
            return Map.of("error", "query 参数必填");
        }
        if (!embeddingService.isEnabled()) {
            return Map.of("error", "向量检索未启用，请在设置 → 大模型 → 向量模型中配置并启用");
        }
        int topK = 5;
        Object topKObj = input.get("top_k");
        if (topKObj instanceof Number n) {
            topK = Math.min(n.intValue(), 20);
        }
        String sourceFilter = (String) input.get("source");

        try {
            float[] queryVec = embeddingService.embed(query);
            List<VectorStore.SearchResult> hits = vectorStore.search(queryVec, topK * 2);

            List<Map<String, Object>> results = hits.stream()
                .filter(h -> sourceFilter == null || sourceFilter.isBlank() || sourceFilter.equals(h.source()))
                .filter(h -> h.score() >= 0.35f)
                .limit(topK)
                .map(h -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", h.id());
                    m.put("source", h.source());
                    m.put("score", Math.round(h.score() * 1000) / 1000.0);
                    m.put("text", h.text().length() > 300 ? h.text().substring(0, 300) + "…" : h.text());
                    return m;
                })
                .toList();

            return Map.of(
                "query", query,
                "count", results.size(),
                "results", results
            );
        } catch (Exception e) {
            log.warn("vector_search 执行失败: {}", e.getMessage());
            return Map.of("error", "向量搜索失败：" + e.getMessage());
        }
    }

    // ============================================================
    // get_skill_detail 执行
    // ============================================================

    private Map<String, Object> executeGetSkillDetail(Map<String, Object> input) {
        String name = (String) input.get("name");
        if (name == null || name.isBlank()) {
            return Map.of("error", "name 参数必填");
        }
        try {
            Map<String, Object> skill = skillStore.findEnabledByName(name);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("name", skill.get("name"));
            result.put("description", skill.get("description"));
            result.put("system_prompt", skill.get("system_prompt"));
            return result;
        } catch (NotFoundException e) {
            return Map.of("error", "Skill 不存在或已禁用：" + name);
        }
    }

    // ============================================================
    // Helper
    // ============================================================

    private String toJson(Object obj) {
        try {
            return mapper.writeValueAsString(obj);
        } catch (Exception e) {
            return "{\"error\":\"序列化失败\"}";
        }
    }
}