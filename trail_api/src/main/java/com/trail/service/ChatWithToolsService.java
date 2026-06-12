package com.trail.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.trail.llm.ApiToolExecutor;
import com.trail.llm.Prompts;
import com.trail.llm.ToolRegistry;
import com.trail.store.AiRecordStore;
import com.trail.store.LLMSettingsStore;
import com.trail.store.exception.LlmNotConfiguredException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 多轮 Tool Use 流式聊天
 * 实现 Anthropic tool use 协议的多轮循环
 *
 * SSE 事件协议：
 *   - data: {"delta":"文本片段"}                    文本输出
 *   - data: {"tool_call":{"name":"...","input":{}}} 工具调用开始
 *   - data: {"tool_result":{"name":"...","ok":true}} 工具执行完成
 *   - data: {"done":true}                           流结束
 *   - data: [DONE]                                  关闭标记
 *   - data: {"error":"..."}                         错误
 */
@Service
public class ChatWithToolsService {

    private static final Logger log = LoggerFactory.getLogger(ChatWithToolsService.class);
    private static final int MAX_TOOL_ITERATIONS = 10;
    private static final String ANTHROPIC_VERSION = "2023-06-01";
    private static final String DEFAULT_MODEL = "claude-haiku-4-5";

    private final LLMSettingsStore settingsStore;
    private final ToolRegistry toolRegistry;
    private final ApiToolExecutor apiToolExecutor;
    private final AiRecordStore aiRecordStore;
    private final ObjectMapper mapper;
    private final ExecutorService executor;

    public ChatWithToolsService(
        LLMSettingsStore settingsStore,
        ToolRegistry toolRegistry,
        ApiToolExecutor apiToolExecutor,
        AiRecordStore aiRecordStore,
        ObjectMapper mapper
    ) {
        this.settingsStore = settingsStore;
        this.toolRegistry = toolRegistry;
        this.apiToolExecutor = apiToolExecutor;
        this.aiRecordStore = aiRecordStore;
        this.mapper = mapper;
        this.executor = Executors.newCachedThreadPool();
    }

    /**
     * 多轮 Tool Use 流式聊天
     */
    public SseEmitter chatStreamWithTools(List<Map<String, String>> messages) {
        SseEmitter emitter = new SseEmitter(120_000L); // 120s 超时（工具调用需要更长时间）

        executor.submit(() -> {
            StringBuilder fullText = new StringBuilder();
            try {
                // 获取 LLM 配置
                LlmConfig cfg = getConfig();

                // 构建初始消息列表（Anthropic API 格式）
                List<ObjectNode> apiMessages = new ArrayList<>();
                for (Map<String, String> m : messages) {
                    ObjectNode msg = mapper.createObjectNode();
                    msg.put("role", m.get("role"));
                    ArrayNode content = mapper.createArrayNode();
                    ObjectNode textBlock = mapper.createObjectNode();
                    textBlock.put("type", "text");
                    textBlock.put("text", m.get("content"));
                    content.add(textBlock);
                    msg.set("content", content);
                    apiMessages.add(msg);
                }

                // 多轮循环
                for (int iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
                    log.info("Tool use iteration {} started", iteration + 1);

                    // 调用 Anthropic API（流式）
                    AnthropicStreamResult result = callAnthropicStream(cfg, apiMessages, emitter, fullText);

                    // 检查 stop_reason
                    String stopReason = result.stopReason();
                    log.info("Iteration {} stop_reason: {}, tool_calls: {}",
                        iteration + 1, stopReason,
                        result.toolUses().stream().map(t -> t.name()).toList());
                    if (stopReason == null || !"tool_use".equals(stopReason) || result.toolUses().isEmpty()) {
                        log.info("Stop reason: {}, ending loop", stopReason);
                        break; // end_turn 或无工具调用，结束
                    }

                    // 回填 assistant message（包含所有 content blocks）
                    apiMessages.add(result.assistantMessage());

                    // 执行工具
                    List<ObjectNode> toolResults = new ArrayList<>();
                    for (ToolUse tu : result.toolUses()) {
                        // 发送 tool_call 事件（包含迭代信息）
                        sendToolCallEvent(emitter, tu.name(), tu.input(), iteration + 1, MAX_TOOL_ITERATIONS);

                        ObjectNode toolResult = mapper.createObjectNode();
                        toolResult.put("type", "tool_result");
                        toolResult.put("tool_use_id", tu.id());

                        try {
                            String resultJson = apiToolExecutor.execute(tu.name(), tu.input());
                            toolResult.put("content", resultJson);
                            // 发送 tool_result 事件
                            sendToolResultEvent(emitter, tu.name(), true);
                            log.debug("Tool {} executed successfully", tu.name());
                        } catch (Exception e) {
                            String errMsg = "工具执行失败：" + e.getMessage();
                            toolResult.put("content", errMsg);
                            toolResult.put("is_error", true);
                            sendToolResultEvent(emitter, tu.name(), false);
                            log.warn("Tool {} failed: {}", tu.name(), e.getMessage());
                        }
                        toolResults.add(toolResult);
                    }

                    // 回填 user message（工具结果）
                    ObjectNode userMsg = mapper.createObjectNode();
                    userMsg.put("role", "user");
                    userMsg.set("content", mapper.valueToTree(toolResults));
                    apiMessages.add(userMsg);
                }

                // 发送结束标记
                emitter.send(SseEmitter.event().data("{\"done\":true}\n\n"));
                emitter.send(SseEmitter.event().data("[DONE]\n\n"));
                emitter.complete();

                // 记录审计
                aiRecordStore.addRecord(
                    null, null, "chat_tool_use",
                    "multi-round tool use",
                    fullText.toString(),
                    false
                );
                log.info("Chat with tools completed, total text length: {}", fullText.length());

            } catch (LlmNotConfiguredException e) {
                sendErrorAndComplete(emitter, "LLM 未配置");
            } catch (Exception e) {
                log.error("Chat with tools error", e);
                sendErrorAndComplete(emitter, e.getMessage());
            }
        });

        return emitter;
    }

    // ============================================================
    // Anthropic API 调用（流式）
    // ============================================================

    /**
     * 调用 Anthropic API（流式）
     * 返回解析后的结果（包含 tool_use blocks）
     */
    private AnthropicStreamResult callAnthropicStream(
        LlmConfig cfg,
        List<ObjectNode> messages,
        SseEmitter emitter,
        StringBuilder fullText
    ) throws Exception {
        HttpClient client = HttpClient.newHttpClient();

        // 构建请求体
        ObjectNode reqBody = mapper.createObjectNode();
        reqBody.put("model", cfg.model());
        reqBody.put("max_tokens", cfg.maxTokens());
        reqBody.put("stream", true);
        reqBody.put("system", buildSystemPrompt());
        reqBody.set("tools", mapper.valueToTree(toolRegistry.getToolsJson()));
        reqBody.set("messages", mapper.valueToTree(messages));

        String jsonBody = mapper.writeValueAsString(reqBody);
        log.debug("Anthropic request: {}", jsonBody.substring(0, Math.min(500, jsonBody.length())));

        HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
            .uri(URI.create(cfg.baseUrl() + "/v1/messages"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(jsonBody));

        // MiniMax 兼容：使用 Bearer 认证，但保留 anthropic-version header
        if (cfg.baseUrl().toLowerCase().contains("minimax")) {
            reqBuilder.header("Authorization", "Bearer " + cfg.apiKey());
            // MiniMax 的 /anthropic 端点也需要 anthropic-version 来启用标准 tool_use 格式
            reqBuilder.header("anthropic-version", ANTHROPIC_VERSION);
        } else {
            reqBuilder.header("x-api-key", cfg.apiKey())
                      .header("anthropic-version", ANTHROPIC_VERSION);
        }

        HttpResponse<java.io.InputStream> response = client.send(
            reqBuilder.build(),
            HttpResponse.BodyHandlers.ofInputStream()
        );

        if (response.statusCode() >= 400) {
            String errorBody = new String(response.body().readAllBytes());
            log.error("Anthropic API error: {}", errorBody);
            throw new RuntimeException("API 返回 " + response.statusCode() + ": " + errorBody);
        }

        // 解析 SSE 流
        List<ToolUse> toolUses = new ArrayList<>();
        ObjectNode assistantMessage = mapper.createObjectNode();
        assistantMessage.put("role", "assistant");
        ArrayNode contentBlocks = mapper.createArrayNode();

        // 用于累积 tool_use 的 input JSON
        Map<Integer, StringBuilder> toolInputBuilders = new HashMap<>();
        Map<Integer, ToolUseBuilder> toolBuilders = new HashMap<>();
        // 用于累积 text block
        Map<Integer, StringBuilder> textBuilders = new HashMap<>();

        String stopReason = null;
        String messageId = null;

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(response.body()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith("data: ")) {
                    String data = line.substring(6);
                    if ("[DONE]".equals(data)) break;

                    JsonNode event = mapper.readTree(data);
                    String eventType = event.has("type") ? event.get("type").asText() : "";

                    switch (eventType) {
                        case "message_start" -> {
                            JsonNode message = event.path("message");
                            messageId = message.path("id").asText();
                        }
                        case "content_block_start" -> {
                            int index = event.get("index").asInt();
                            JsonNode block = event.get("content_block");
                            String blockType = block.get("type").asText();

                            if ("tool_use".equals(blockType)) {
                                String id = block.get("id").asText();
                                String name = block.get("name").asText();
                                toolBuilders.put(index, new ToolUseBuilder(id, name));
                                toolInputBuilders.put(index, new StringBuilder());
                            } else if ("text".equals(blockType)) {
                                textBuilders.put(index, new StringBuilder());
                                // 预创建 text block
                                ObjectNode textBlock = mapper.createObjectNode();
                                textBlock.put("type", "text");
                                textBlock.put("text", ""); // 后续填充
                                // 先占位，后续在 content_block_stop 时更新
                            }
                        }
                        case "content_block_delta" -> {
                            int index = event.get("index").asInt();
                            JsonNode delta = event.get("delta");
                            String deltaType = delta.path("type").asText();

                            if ("text_delta".equals(deltaType)) {
                                String text = delta.path("text").asText();
                                fullText.append(text);
                                textBuilders.computeIfAbsent(index, k -> new StringBuilder()).append(text);
                                // 发送文本事件
                                emitter.send(SseEmitter.event().data(
                                    "{\"delta\":\"" + escapeJson(text) + "\"}\n\n"
                                ));
                            } else if ("input_json_delta".equals(deltaType)) {
                                String partial = delta.path("partial_json").asText();
                                toolInputBuilders.computeIfAbsent(index, k -> new StringBuilder())
                                    .append(partial);
                            }
                        }
                        case "content_block_stop" -> {
                            int index = event.get("index").asInt();

                            // 完成 text block
                            if (textBuilders.containsKey(index)) {
                                String textContent = textBuilders.get(index).toString();
                                ObjectNode textBlock = mapper.createObjectNode();
                                textBlock.put("type", "text");
                                textBlock.put("text", textContent);
                                contentBlocks.add(textBlock);
                            }

                            // 完成 tool_use block
                            if (toolBuilders.containsKey(index)) {
                                ToolUseBuilder builder = toolBuilders.get(index);
                                String inputJson = toolInputBuilders.getOrDefault(index, new StringBuilder())
                                    .toString();
                                Map<String, Object> input = parseInputJson(inputJson);

                                // 构建 tool_use block
                                ObjectNode toolBlock = mapper.createObjectNode();
                                toolBlock.put("type", "tool_use");
                                toolBlock.put("id", builder.id);
                                toolBlock.put("name", builder.name);
                                toolBlock.set("input", mapper.valueToTree(input));
                                contentBlocks.add(toolBlock);

                                // 记录 tool use
                                toolUses.add(new ToolUse(builder.id, builder.name, input));
                            }
                        }
                        case "message_delta" -> {
                            if (event.has("delta")) {
                                JsonNode delta = event.get("delta");
                                if (delta.has("stop_reason")) {
                                    stopReason = delta.get("stop_reason").asText();
                                }
                            }
                        }
                        case "message_stop" -> {
                            // 消息结束
                            break;
                        }
                    }
                }
            }
        }

        // 设置 assistant message 的 content
        assistantMessage.set("content", contentBlocks);

        return new AnthropicStreamResult(toolUses, stopReason, assistantMessage);
    }

    // ============================================================
    // Helper
    // ============================================================

    private LlmConfig getConfig() {
        Map<String, String> settings = settingsStore.getAll();
        String apiKey = settings.get("api_key");
        if (apiKey == null || apiKey.isBlank()) {
            throw new LlmNotConfiguredException();
        }
        String baseUrl = settings.getOrDefault("base_url", "https://api.anthropic.com");
        String model = settings.getOrDefault("model", DEFAULT_MODEL);
        int maxTokens = 2000;
        String maxTokensStr = settings.get("max_tokens");
        if (maxTokensStr != null && !maxTokensStr.isBlank()) {
            try { maxTokens = Integer.parseInt(maxTokensStr); }
            catch (NumberFormatException ignored) {}
        }
        return new LlmConfig(apiKey, baseUrl, model, maxTokens);
    }

    /**
     * 构建 System Prompt，注入日期 + TOOLS_DESC（从配置读取或使用默认值）
     */
    private String buildSystemPrompt() {
        LocalDate today = LocalDate.now();
        LocalDate yesterday = today.minusDays(1);
        String weekday = switch (today.getDayOfWeek()) {
            case MONDAY -> "一";
            case TUESDAY -> "二";
            case WEDNESDAY -> "三";
            case THURSDAY -> "四";
            case FRIDAY -> "五";
            case SATURDAY -> "六";
            case SUNDAY -> "日";
        };

        String nowBlock = """
            当前时间信息（请直接用以下日期，不要自己猜测）：
            - 今天：%s（星期%s）
            - 昨天：%s

            """.formatted(today, weekday, yesterday);

        // 从配置读取 tools_desc，为空时使用默认值
        Map<String, String> settings = settingsStore.getAll();
        String toolsDesc = settings.get("tools_desc");
        if (toolsDesc == null || toolsDesc.isBlank()) {
            toolsDesc = Prompts.TOOLS_DESC;
        }

        // 从配置读取 chat_system_prompt，为空时使用默认值
        String chatSystemPrompt = settings.get("chat_system_prompt");
        if (chatSystemPrompt == null || chatSystemPrompt.isBlank()) {
            chatSystemPrompt = Prompts.DEFAULT_CHAT_SYSTEM;
        }

        String systemPrompt = chatSystemPrompt.replace("{tools_desc}", toolsDesc);

        return nowBlock + systemPrompt;
    }

    private void sendToolCallEvent(SseEmitter emitter, String name, Map<String, Object> input, int iteration, int maxIterations)
        throws Exception {
        ObjectNode event = mapper.createObjectNode();
        ObjectNode toolCall = mapper.createObjectNode();
        toolCall.put("name", name);
        toolCall.set("input", mapper.valueToTree(input));
        event.set("tool_call", toolCall);
        // 添加迭代信息
        ObjectNode iterInfo = mapper.createObjectNode();
        iterInfo.put("current", iteration);
        iterInfo.put("max", maxIterations);
        event.set("iteration", iterInfo);
        emitter.send(SseEmitter.event().data(mapper.writeValueAsString(event) + "\n\n"));
    }

    private void sendToolResultEvent(SseEmitter emitter, String name, boolean ok)
        throws Exception {
        ObjectNode event = mapper.createObjectNode();
        ObjectNode toolResult = mapper.createObjectNode();
        toolResult.put("name", name);
        toolResult.put("ok", ok);
        event.set("tool_result", toolResult);
        emitter.send(SseEmitter.event().data(mapper.writeValueAsString(event) + "\n\n"));
    }

    private void sendErrorAndComplete(SseEmitter emitter, String errorMsg) {
        try {
            emitter.send(SseEmitter.event().data("{\"error\":\"" + escapeJson(errorMsg) + "\"}\n\n"));
            emitter.complete();
        } catch (Exception ignored) {}
    }

    private String escapeJson(String text) {
        if (text == null) return "";
        return text.replace("\\", "\\\\")
                   .replace("\"", "\\\"")
                   .replace("\n", "\\n")
                   .replace("\r", "\\r")
                   .replace("\t", "\\t");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseInputJson(String json) {
        if (json == null || json.isBlank()) {
            return new HashMap<>();
        }
        try {
            return mapper.readValue(json, Map.class);
        } catch (Exception e) {
            log.warn("Failed to parse tool input JSON: {}", json);
            return new HashMap<>();
        }
    }

    // ============================================================
    // 内部记录
    // ============================================================

    private record LlmConfig(String apiKey, String baseUrl, String model, int maxTokens) {}

    private record ToolUse(String id, String name, Map<String, Object> input) {}

    private record ToolUseBuilder(String id, String name) {}

    private record AnthropicStreamResult(
        List<ToolUse> toolUses,
        String stopReason,
        ObjectNode assistantMessage
    ) {}
}