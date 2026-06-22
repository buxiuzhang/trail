package com.trail.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.trail.store.McpServerStore;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * MCP Client 连接管理器
 *
 * 支持两种连接方式：
 *   - stdio：通过 ProcessBuilder 启动子进程，基于 stdin/stdout 实现 JSON-RPC 2.0
 *   - SSE：通过 HTTP 连接远程 MCP Server（JSON-RPC over HTTP POST + SSE）
 */
@Component
public class McpClientManager {

    private static final Logger log = LoggerFactory.getLogger(McpClientManager.class);

    private final McpServerStore store;
    private final ObjectMapper mapper;
    private final HttpClient httpClient;

    /** serverId → 已发现的工具列表（Tool 对象） */
    private final Map<String, List<Tool>> toolCache = new ConcurrentHashMap<>();

    /** serverId → stdio 进程（仅 stdio 类型） */
    private final Map<String, Process> processes = new ConcurrentHashMap<>();

    /** JSON-RPC 请求 ID 生成器 */
    private final AtomicInteger idGen = new AtomicInteger(1);

    public McpClientManager(McpServerStore store, ObjectMapper mapper) {
        this.store = store;
        this.mapper = mapper;
        this.httpClient = HttpClient.newHttpClient();
    }

    // ============================================================
    // 公共 API
    // ============================================================

    /**
     * 获取所有 enabled server 的工具，工具名格式：mcp__<serverId>__<toolName>
     */
    public List<Tool> getAllTools() {
        List<Tool> all = new ArrayList<>();
        for (Map.Entry<String, List<Tool>> entry : toolCache.entrySet()) {
            all.addAll(entry.getValue());
        }
        return all;
    }

    /**
     * 调用 MCP 工具。toolName 格式：mcp__<serverId>__<originalToolName>
     */
    public String callTool(String prefixedName, Map<String, Object> input) {
        String[] parts = prefixedName.split("__", 3);
        if (parts.length != 3) {
            return "{\"error\":\"无效的 MCP 工具名：" + prefixedName + "\"}";
        }
        String serverId = parts[1];
        String toolName = parts[2];

        Map<String, Object> serverRow;
        try {
            serverRow = store.findById(serverId);
        } catch (Exception e) {
            return "{\"error\":\"MCP Server 不存在：" + serverId + "\"}";
        }

        String type = (String) serverRow.get("type");
        try {
            if ("stdio".equals(type)) {
                return callStdioTool(serverRow, toolName, input);
            } else {
                return callSseTool(serverRow, toolName, input);
            }
        } catch (Exception e) {
            log.error("MCP tool call failed: {} -> {}", serverId, toolName, e);
            return "{\"error\":\"MCP 工具调用失败：" + e.getMessage() + "\"}";
        }
    }

    /**
     * 刷新指定 server 的工具列表（新增/更新配置后调用）
     */
    public void refresh(String serverId) {
        try {
            Map<String, Object> row = store.findById(serverId);
            if (Integer.valueOf(1).equals(row.get("enabled")) || Boolean.TRUE.equals(row.get("enabled"))) {
                List<Tool> tools = fetchTools(row);
                toolCache.put(serverId, tools);
                log.info("MCP server {} refreshed, {} tools loaded", serverId, tools.size());
            } else {
                toolCache.remove(serverId);
                terminateProcess(serverId);
            }
        } catch (Exception e) {
            log.warn("Failed to refresh MCP server {}: {}", serverId, e.getMessage());
            toolCache.remove(serverId);
        }
    }

    /**
     * 断开连接并从缓存移除（删除配置后调用）
     */
    public void disconnect(String serverId) {
        toolCache.remove(serverId);
        terminateProcess(serverId);
    }

    /**
     * 测试连通性，返回工具列表
     */
    public Map<String, Object> testConnection(String serverId) {
        try {
            Map<String, Object> row = store.findById(serverId);
            List<Tool> tools = fetchTools(row);
            List<Map<String, Object>> toolList = tools.stream()
                    .map(t -> Map.<String, Object>of(
                            "name", t.name().replaceFirst("^mcp__[^_]+__", ""),
                            "description", t.description() != null ? t.description() : ""))
                    .toList();
            return Map.of("ok", true, "tools", toolList, "count", toolList.size());
        } catch (Exception e) {
            log.warn("MCP connection test failed for {}: {}", serverId, e.getMessage());
            return Map.of("ok", false, "error", e.getMessage());
        }
    }

    /**
     * 重新加载所有 enabled server（应用启动时调用）
     */
    public void refreshAll() {
        try {
            List<Map<String, Object>> servers = store.findAllEnabled();
            for (Map<String, Object> row : servers) {
                String id = (String) row.get("id");
                try {
                    List<Tool> tools = fetchTools(row);
                    toolCache.put(id, tools);
                    log.info("MCP server {} loaded, {} tools", id, tools.size());
                } catch (Exception e) {
                    log.warn("MCP server {} failed to load: {}", id, e.getMessage());
                }
            }
        } catch (Exception e) {
            log.warn("refreshAll failed: {}", e.getMessage());
        }
    }

    // ============================================================
    // stdio 实现
    // ============================================================

    private List<Tool> fetchStdioTools(Map<String, Object> row) throws Exception {
        String serverId = (String) row.get("id");
        String command = (String) row.get("command");
        String argsJson = (String) row.get("args");
        String envJson = (String) row.get("env");

        if (command == null || command.isBlank()) {
            throw new IllegalArgumentException("stdio MCP Server 缺少 command 配置");
        }

        List<String> cmdList = new ArrayList<>();
        cmdList.add(command);
        if (argsJson != null && !argsJson.isBlank()) {
            JsonNode argsNode = mapper.readTree(argsJson);
            if (argsNode.isArray()) {
                argsNode.forEach(n -> cmdList.add(n.asText()));
            }
        }

        ProcessBuilder pb = new ProcessBuilder(cmdList);
        pb.redirectErrorStream(false);

        if (envJson != null && !envJson.isBlank()) {
            JsonNode envNode = mapper.readTree(envJson);
            envNode.fields().forEachRemaining(e -> pb.environment().put(e.getKey(), e.getValue().asText()));
        }

        Process proc = pb.start();
        processes.put(serverId, proc);

        PrintWriter writer = new PrintWriter(new OutputStreamWriter(proc.getOutputStream(), StandardCharsets.UTF_8), true);
        BufferedReader reader = new BufferedReader(new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8));

        // initialize
        sendJsonRpc(writer, "initialize", Map.of(
                "protocolVersion", "2024-11-05",
                "capabilities", Map.of(),
                "clientInfo", Map.of("name", "trail", "version", "2.0")));
        readJsonRpcResponse(reader); // ignore initialize response

        // initialized notification
        sendJsonRpcNotification(writer, "notifications/initialized", Map.of());

        // tools/list
        sendJsonRpc(writer, "tools/list", Map.of());
        JsonNode resp = readJsonRpcResponse(reader);

        return parseToolsFromResponse(resp, (String) row.get("id"));
    }

    private String callStdioTool(Map<String, Object> row, String toolName, Map<String, Object> input) throws Exception {
        String serverId = (String) row.get("id");
        String command = (String) row.get("command");
        String argsJson = (String) row.get("args");
        String envJson = (String) row.get("env");

        List<String> cmdList = new ArrayList<>();
        cmdList.add(command);
        if (argsJson != null && !argsJson.isBlank()) {
            JsonNode argsNode = mapper.readTree(argsJson);
            if (argsNode.isArray()) {
                argsNode.forEach(n -> cmdList.add(n.asText()));
            }
        }

        // stdio 进程每次工具调用都重新启动（无状态模式，保证可靠性）
        ProcessBuilder pb = new ProcessBuilder(cmdList);
        pb.redirectErrorStream(false);
        if (envJson != null && !envJson.isBlank()) {
            JsonNode envNode = mapper.readTree(envJson);
            envNode.fields().forEachRemaining(e -> pb.environment().put(e.getKey(), e.getValue().asText()));
        }

        Process proc = pb.start();
        try {
            PrintWriter writer = new PrintWriter(new OutputStreamWriter(proc.getOutputStream(), StandardCharsets.UTF_8), true);
            BufferedReader reader = new BufferedReader(new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8));

            sendJsonRpc(writer, "initialize", Map.of(
                    "protocolVersion", "2024-11-05",
                    "capabilities", Map.of(),
                    "clientInfo", Map.of("name", "trail", "version", "2.0")));
            readJsonRpcResponse(reader);

            sendJsonRpcNotification(writer, "notifications/initialized", Map.of());

            sendJsonRpc(writer, "tools/call", Map.of("name", toolName, "arguments", input != null ? input : Map.of()));
            JsonNode resp = readJsonRpcResponse(reader);

            if (resp.has("error")) {
                return "{\"error\":\"" + escapeJson(resp.get("error").toString()) + "\"}";
            }

            JsonNode result = resp.path("result");
            JsonNode content = result.path("content");
            if (content.isArray() && content.size() > 0) {
                JsonNode first = content.get(0);
                if ("text".equals(first.path("type").asText())) {
                    return first.path("text").asText();
                }
            }
            return mapper.writeValueAsString(result);
        } finally {
            proc.destroyForcibly();
        }
    }

    // ============================================================
    // SSE 实现
    // ============================================================

    private List<Tool> fetchSseTools(Map<String, Object> row) throws Exception {
        String url = (String) row.get("url");
        if (url == null || url.isBlank()) {
            throw new IllegalArgumentException("SSE MCP Server 缺少 url 配置");
        }

        String endpoint = url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
        String rpcUrl = endpoint.replace("/sse", "") + "/message";

        ObjectNode rpcBody = mapper.createObjectNode();
        rpcBody.put("jsonrpc", "2.0");
        rpcBody.put("id", idGen.getAndIncrement());
        rpcBody.put("method", "tools/list");
        rpcBody.set("params", mapper.createObjectNode());

        HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                .uri(URI.create(rpcUrl))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(rpcBody)));

        applyHeaders(reqBuilder, (String) row.get("headers"));

        HttpResponse<String> resp = httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() >= 400) {
            throw new RuntimeException("SSE MCP Server 返回 " + resp.statusCode());
        }

        JsonNode respNode = mapper.readTree(resp.body());
        return parseToolsFromResponse(respNode, (String) row.get("id"));
    }

    private String callSseTool(Map<String, Object> row, String toolName, Map<String, Object> input) throws Exception {
        String url = (String) row.get("url");
        String endpoint = url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
        String rpcUrl = endpoint.replace("/sse", "") + "/message";

        ObjectNode rpcBody = mapper.createObjectNode();
        rpcBody.put("jsonrpc", "2.0");
        rpcBody.put("id", idGen.getAndIncrement());
        rpcBody.put("method", "tools/call");
        ObjectNode params = mapper.createObjectNode();
        params.put("name", toolName);
        params.set("arguments", mapper.valueToTree(input != null ? input : Map.of()));
        rpcBody.set("params", params);

        HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                .uri(URI.create(rpcUrl))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(rpcBody)));

        applyHeaders(reqBuilder, (String) row.get("headers"));

        HttpResponse<String> resp = httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() >= 400) {
            return "{\"error\":\"SSE MCP Server 返回 " + resp.statusCode() + "\"}";
        }

        JsonNode respNode = mapper.readTree(resp.body());
        if (respNode.has("error")) {
            return "{\"error\":\"" + escapeJson(respNode.get("error").toString()) + "\"}";
        }

        JsonNode result = respNode.path("result");
        JsonNode content = result.path("content");
        if (content.isArray() && content.size() > 0) {
            JsonNode first = content.get(0);
            if ("text".equals(first.path("type").asText())) {
                return first.path("text").asText();
            }
        }
        return mapper.writeValueAsString(result);
    }

    // ============================================================
    // 统一入口
    // ============================================================

    private List<Tool> fetchTools(Map<String, Object> row) throws Exception {
        String type = (String) row.get("type");
        if ("stdio".equals(type)) {
            return fetchStdioTools(row);
        } else {
            return fetchSseTools(row);
        }
    }

    // ============================================================
    // JSON-RPC helpers（stdio）
    // ============================================================

    private void sendJsonRpc(PrintWriter writer, String method, Map<String, Object> params) throws Exception {
        ObjectNode req = mapper.createObjectNode();
        req.put("jsonrpc", "2.0");
        req.put("id", idGen.getAndIncrement());
        req.put("method", method);
        req.set("params", mapper.valueToTree(params));
        writer.println(mapper.writeValueAsString(req));
    }

    private void sendJsonRpcNotification(PrintWriter writer, String method, Map<String, Object> params) throws Exception {
        ObjectNode req = mapper.createObjectNode();
        req.put("jsonrpc", "2.0");
        req.put("method", method);
        req.set("params", mapper.valueToTree(params));
        writer.println(mapper.writeValueAsString(req));
    }

    private JsonNode readJsonRpcResponse(BufferedReader reader) throws IOException {
        String line;
        while ((line = reader.readLine()) != null) {
            line = line.trim();
            if (line.isEmpty()) continue;
            try {
                JsonNode node = mapper.readTree(line);
                if (node.has("id") || node.has("error")) {
                    return node;
                }
            } catch (Exception ignored) {}
        }
        return mapper.createObjectNode();
    }

    // ============================================================
    // Tool 解析
    // ============================================================

    private List<Tool> parseToolsFromResponse(JsonNode resp, String serverId) {
        JsonNode tools = resp.path("result").path("tools");
        if (!tools.isArray()) return Collections.emptyList();

        List<Tool> result = new ArrayList<>();
        for (JsonNode t : tools) {
            String name = t.path("name").asText();
            String description = t.path("description").asText();
            JsonNode schemaNode = t.path("inputSchema");

            ObjectNode properties;
            List<String> required = new ArrayList<>();

            if (schemaNode.has("properties") && schemaNode.get("properties").isObject()) {
                properties = (ObjectNode) schemaNode.get("properties");
            } else {
                properties = mapper.createObjectNode();
            }

            if (schemaNode.has("required") && schemaNode.get("required").isArray()) {
                schemaNode.get("required").forEach(r -> required.add(r.asText()));
            }

            String prefixedName = "mcp__" + serverId + "__" + name;
            result.add(new Tool(prefixedName, "[MCP] " + description,
                    new Tool.InputSchema("object", properties, required.isEmpty() ? null : required)));
        }
        return result;
    }

    // ============================================================
    // 工具方法
    // ============================================================

    private void applyHeaders(HttpRequest.Builder builder, String headersJson) throws Exception {
        if (headersJson == null || headersJson.isBlank()) return;
        JsonNode node = mapper.readTree(headersJson);
        node.fields().forEachRemaining(e -> builder.header(e.getKey(), e.getValue().asText()));
    }

    private void terminateProcess(String serverId) {
        Process proc = processes.remove(serverId);
        if (proc != null && proc.isAlive()) {
            proc.destroyForcibly();
        }
    }

    private String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r");
    }

    @PreDestroy
    public void shutdown() {
        processes.values().forEach(p -> {
            if (p.isAlive()) p.destroyForcibly();
        });
        processes.clear();
    }
}
