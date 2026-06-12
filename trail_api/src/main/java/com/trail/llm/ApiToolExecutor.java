package com.trail.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * API 工具执行器
 * 执行 get_api_docs 和 call_api 两个工具
 */
@Component
public class ApiToolExecutor {

    private static final Logger log = LoggerFactory.getLogger(ApiToolExecutor.class);

    private final OpenApiService openApiService;
    private final ObjectMapper mapper;
    private final HttpClient client;

    public ApiToolExecutor(OpenApiService openApiService, ObjectMapper mapper) {
        this.openApiService = openApiService;
        this.mapper = mapper;
        this.client = HttpClient.newHttpClient();
    }

    /**
     * 执行工具调用
     */
    public String execute(String name, Map<String, Object> input) {
        try {
            Object result = switch (name) {
                case "get_api_docs" -> executeGetApiDocs(input);
                case "call_api" -> executeCallApi(input);
                default -> throw new IllegalArgumentException("未知工具：" + name);
            };
            return toJson(result);
        } catch (Exception e) {
            log.error("Tool {} execution failed", name, e);
            return toJson(Map.of("error", "工具执行失败：" + e.getMessage()));
        }
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