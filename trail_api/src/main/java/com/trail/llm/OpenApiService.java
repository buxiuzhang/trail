package com.trail.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.*;
import java.util.stream.Collectors;

/**
 * OpenAPI 文档服务
 * 从 /v3/api-docs 加载 API 文档，提供搜索和查询功能
 */
@Service
public class OpenApiService {

    private static final Logger log = LoggerFactory.getLogger(OpenApiService.class);

    private final ObjectMapper mapper;
    private JsonNode apiDocs;
    private final Set<String> forbiddenPaths = Set.of(
        "/api/llm/",           // LLM 相关（避免递归）
        "/api/chat/",          // 聊天流式接口
        "/api/settings/llm",   // LLM 配置（含 API Key）
        "/api/attachments",    // 附件上传
        "/api/settings/data-dir"  // 数据目录切换
    );

    public OpenApiService(ObjectMapper mapper) {
        this.mapper = mapper;
        // 延迟加载：不在构造函数中调用，等服务器启动后再加载
    }

    /**
     * 加载 OpenAPI 文档（延迟加载）
     */
    public void loadApiDocs() {
        if (apiDocs != null) return;  // 已加载
        tryLoad();
    }

    /**
     * 强制重新加载
     */
    public void reloadApiDocs() {
        tryLoad();
    }

    private void tryLoad() {
        try {
            HttpClient client = HttpClient.newHttpClient();
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:8765/v3/api-docs"))
                .GET()
                .build();
            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
            this.apiDocs = mapper.readTree(resp.body());
            log.info("Loaded OpenAPI docs, {} paths", apiDocs.path("paths").size());
        } catch (Exception e) {
            log.error("Failed to load OpenAPI docs", e);
        }
    }

    /**
     * 搜索 API 文档
     * @param keyword 搜索关键词（如"添加"、"查询"、"任务"）
     * @return 匹配的 API 列表
     */
    public List<ApiInfo> searchApiDocs(String keyword) {
        // 延迟加载
        if (apiDocs == null) {
            loadApiDocs();
        }
        if (apiDocs == null) return List.of();

        List<ApiInfo> results = new ArrayList<>();
        JsonNode paths = apiDocs.path("paths");

        Iterator<Map.Entry<String, JsonNode>> it = paths.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> entry = it.next();
            String path = entry.getKey();
            if (isForbidden(path)) continue;

            JsonNode methods = entry.getValue();
            Iterator<Map.Entry<String, JsonNode>> mit = methods.fields();
            while (mit.hasNext()) {
                Map.Entry<String, JsonNode> methodEntry = mit.next();
                String method = methodEntry.getKey().toUpperCase();
                if ("DELETE".equals(method)) continue;  // 禁止 DELETE

                JsonNode info = methodEntry.getValue();
                String summary = info.path("summary").asText("");
                String description = info.path("description").asText("");
                String tag = info.path("tags").isArray()
                    ? info.path("tags").get(0).asText("") : "";

                // 搜索匹配
                String searchText = summary + " " + description + " " + tag + " " + path;
                if (keyword == null || keyword.isBlank() ||
                    searchText.toLowerCase().contains(keyword.toLowerCase())) {
                    results.add(new ApiInfo(
                        method, path, summary, description, tag,
                        extractParameters(info)
                    ));
                }
            }
        }

        return results;
    }

    /**
     * 获取具体 API 的详细信息
     * @param path API 路径
     * @return API 详细信息（包含参数定义）
     */
    public ApiInfo getApiDetail(String path) {
        // 延迟加载
        if (apiDocs == null) {
            loadApiDocs();
        }
        if (apiDocs == null || path == null) return null;

        JsonNode pathNode = apiDocs.path("paths").path(path);
        if (pathNode.isMissingNode()) return null;

        // 返回所有方法的详细信息
        List<ApiInfo> methods = new ArrayList<>();
        Iterator<Map.Entry<String, JsonNode>> mit = pathNode.fields();
        while (mit.hasNext()) {
            Map.Entry<String, JsonNode> methodEntry = mit.next();
            String method = methodEntry.getKey().toUpperCase();
            if ("DELETE".equals(method) || isForbidden(path)) continue;

            JsonNode info = methodEntry.getValue();
            String summary = info.path("summary").asText("");
            String description = info.path("description").asText("");
            String tag = info.path("tags").isArray()
                ? info.path("tags").get(0).asText("") : "";

            methods.add(new ApiInfo(
                method, path, summary, description, tag,
                extractParameters(info)
            ));
        }

        // 返回第一个方法（通常一个路径只有一个主要方法）
        return methods.isEmpty() ? null : methods.get(0);
    }

    /**
     * 获取所有允许的 API 列表（供 LLM 参考）
     */
    public List<ApiInfo> getAllowedApis() {
        return searchApiDocs(null);
    }

    /**
     * 检查路径是否被禁止
     */
    public boolean isForbidden(String path) {
        return forbiddenPaths.stream().anyMatch(fp -> path.startsWith(fp) || path.equals(fp));
    }

    /**
     * 检查方法是否需要用户确认
     */
    public boolean needsConfirmation(String method) {
        return "POST".equals(method) || "PUT".equals(method);
    }

    /**
     * 提取参数信息
     */
    private List<ParamInfo> extractParameters(JsonNode info) {
        List<ParamInfo> params = new ArrayList<>();

        // Path 参数
        JsonNode pathParams = info.path("parameters");
        if (pathParams.isArray()) {
            for (JsonNode p : pathParams) {
                if ("path".equals(p.path("in").asText())) {
                    params.add(new ParamInfo(
                        "path",
                        p.path("name").asText(),
                        p.path("description").asText(""),
                        p.path("required").asBoolean(false),
                        p.path("schema").path("type").asText("")
                    ));
                }
            }
        }

        // Query 参数
        if (pathParams.isArray()) {
            for (JsonNode p : pathParams) {
                if ("query".equals(p.path("in").asText())) {
                    params.add(new ParamInfo(
                        "query",
                        p.path("name").asText(),
                        p.path("description").asText(""),
                        p.path("required").asBoolean(false),
                        p.path("schema").path("type").asText("")
                    ));
                }
            }
        }

        // Request Body - 解析具体字段
        JsonNode requestBody = info.path("requestBody");
        if (!requestBody.isMissingNode()) {
            JsonNode content = requestBody.path("content").path("application/json");
            if (!content.isMissingNode()) {
                JsonNode schemaRef = content.path("schema");
                // 如果是 $ref，解析引用的 schema
                if (schemaRef.has("$ref")) {
                    String ref = schemaRef.path("$ref").asText();
                    String schemaName = ref.replace("#/components/schemas/", "");
                    JsonNode schemaDef = apiDocs.path("components").path("schemas").path(schemaName);
                    if (!schemaDef.isMissingNode()) {
                        JsonNode props = schemaDef.path("properties");
                        if (props.isObject()) {
                            String bodyDesc = requestBody.path("description").asText("");
                            params.add(new ParamInfo("body", "body", bodyDesc, true, "object"));
                            // 添加具体字段
                            Iterator<Map.Entry<String, JsonNode>> pit = props.fields();
                            while (pit.hasNext()) {
                                Map.Entry<String, JsonNode> prop = pit.next();
                                boolean required = schemaDef.path("required").isArray() &&
                                    schemaDef.path("required").asText().contains(prop.getKey());
                                params.add(new ParamInfo(
                                    "body_field",
                                    prop.getKey(),
                                    prop.getValue().path("description").asText(""),
                                    required,
                                    prop.getValue().path("type").asText("")
                                ));
                            }
                        }
                    }
                } else {
                    String desc = requestBody.path("description").asText("");
                    params.add(new ParamInfo("body", "body", desc, true, "object"));
                }
            }
        }

        return params;
    }

    // ============================================================
    // 数据结构
    // ============================================================

    public record ApiInfo(
        String method,
        String path,
        String summary,
        String description,
        String tag,
        List<ParamInfo> parameters
    ) {
        public String toMarkdown() {
            StringBuilder sb = new StringBuilder();
            sb.append("**").append(method).append(" ").append(path).append("**\n");
            sb.append("- 标签：").append(tag).append("\n");
            sb.append("- 说明：").append(summary).append("\n");
            if (!description.isBlank()) {
                sb.append("- 详情：").append(description).append("\n");
            }
            if (!parameters.isEmpty()) {
                sb.append("- 参数：\n");
                for (ParamInfo p : parameters) {
                    if ("body_field".equals(p.location())) {
                        // body 字段单独处理
                        sb.append("    - `").append(p.name()).append("`");
                        if (p.required()) sb.append("（必填）");
                        if (!p.description().isBlank()) sb.append("：").append(p.description());
                        sb.append(" [").append(p.type()).append("]\n");
                    } else {
                        sb.append("  - ").append(p.location()).append(" `").append(p.name()).append("`");
                        if (p.required()) sb.append("（必填）");
                        if (!p.description().isBlank()) sb.append("：").append(p.description());
                        sb.append("\n");
                    }
                }
            }
            return sb.toString();
        }
    }

    public record ParamInfo(
        String location,  // path, query, body
        String name,
        String description,
        boolean required,
        String type
    ) {}
}