package com.trail.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trail.llm.Prompts;
import com.trail.store.AiRecordStore;
import com.trail.store.LLMSettingsStore;
import com.trail.store.TaskStore;
import com.trail.store.WorkLogStore;
import com.trail.store.exception.LlmApiException;
import com.trail.store.exception.LlmNotConfiguredException;
import com.trail.store.exception.NotFoundException;
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
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * LLM 服务层
 * 封装 Anthropic API 调用逻辑
 * Prompt 模板在启动时从数据库加载到内存
 */
@Service
public class LlmService {

    private static final Logger log = LoggerFactory.getLogger(LlmService.class);
    private static final String ANTHROPIC_VERSION = "2023-06-01";
    private static final String DEFAULT_MODEL = "claude-haiku-4-5";
    private static final int DEFAULT_MAX_TOKENS = 1000;

    private final LLMSettingsStore settingsStore;
    private final TaskStore taskStore;
    private final WorkLogStore workLogStore;
    private final AiRecordStore aiRecordStore;
    private final ObjectMapper mapper;
    private final ExecutorService executor;

    // Prompt 缓存（启动时加载）
    private volatile String cachedPolishPrompt;
    private volatile String cachedPolishTodoPrompt;
    private volatile String cachedSummarizePrompt;
    private volatile String cachedSummarizeMaintenancePrompt;
    private volatile String cachedAskMaintenancePrompt;
    private volatile String cachedChatPrompt;

    public LlmService(LLMSettingsStore settingsStore, TaskStore taskStore,
                      WorkLogStore workLogStore, AiRecordStore aiRecordStore) {
        this.settingsStore = settingsStore;
        this.taskStore = taskStore;
        this.workLogStore = workLogStore;
        this.aiRecordStore = aiRecordStore;
        this.mapper = new ObjectMapper();
        this.executor = Executors.newCachedThreadPool();

        // 启动时加载 prompt 到内存
        loadPrompts();
    }

    /** 从数据库加载 prompt 到内存缓存 */
    private void loadPrompts() {
        Map<String, String> settings = settingsStore.getAll();
        cachedPolishPrompt = getOrDefault(settings, "polish_system_prompt", Prompts.POLISH_SYSTEM);
        cachedPolishTodoPrompt = getOrDefault(settings, "polish_todo_system_prompt", Prompts.POLISH_TODO_SYSTEM);
        cachedSummarizePrompt = getOrDefault(settings, "summarize_system_prompt", Prompts.SUMMARIZE_MAIN_SYSTEM);
        cachedSummarizeMaintenancePrompt = getOrDefault(settings, "summarize_maintenance_prompt", Prompts.SUMMARIZE_MAINTENANCE_SYSTEM);
        cachedAskMaintenancePrompt = getOrDefault(settings, "ask_maintenance_prompt", Prompts.ASK_MAINTENANCE_SYSTEM);
        cachedChatPrompt = getOrDefault(settings, "chat_system_prompt", Prompts.DEFAULT_CHAT_SYSTEM);
        log.info("Prompt 模板已加载到内存");
    }

    /** 刷新 prompt 缓存（设置保存后调用） */
    public void refreshPrompts() {
        loadPrompts();
    }

    private String getOrDefault(Map<String, String> settings, String key, String defaultValue) {
        String value = settings.get(key);
        return (value == null || value.isBlank()) ? defaultValue : value;
    }

    // ============================================================
    // 配置获取
    // ============================================================

    private LlmConfig getConfig() {
        Map<String, String> settings = settingsStore.getAll();
        String apiKey = settings.get("api_key");
        if (apiKey == null || apiKey.isBlank()) {
            throw new LlmNotConfiguredException();
        }
        String baseUrl = settings.getOrDefault("base_url", "https://api.anthropic.com");
        String model = settings.getOrDefault("model", DEFAULT_MODEL);
        int maxTokens = 1000;
        String maxTokensStr = settings.get("max_tokens");
        if (maxTokensStr != null && !maxTokensStr.isBlank()) {
            try { maxTokens = Integer.parseInt(maxTokensStr); }
            catch (NumberFormatException ignored) {}
        }
        return new LlmConfig(apiKey, baseUrl, model, maxTokens);
    }

    // ============================================================
    // 润色
    // ============================================================

    /** 润色文本，支持日志和待办两种类型 */
    public String polish(String content, Long taskId, String type) {
        LlmConfig cfg = getConfig();
        String system = "todo".equals(type) ? cachedPolishTodoPrompt : cachedPolishPrompt;
        String user = Prompts.POLISH_USER.replace("{content}", content);

        AnthropicResponse resp = callAnthropic(cfg, system, List.of(userMessage(user)));
        String promptText = "[system]\n" + system + "\n\n[user]\n" + user;
        aiRecordStore.addRecord(taskId, null, "polish", promptText, resp.raw(), false);

        return resp.text();
    }

    /** 兼容旧接口：日志润色 */
    public String polish(String content, Long taskId) {
        return polish(content, taskId, "log");
    }

    // ============================================================
    // 主体阶段总结
    // ============================================================

    public String summarizeMain(long taskId) {
        LlmConfig cfg = getConfig();
        Map<String, Object> task = taskStore.getTask(taskId);
        String title = (String) task.get("title");

        List<Map<String, Object>> logs = workLogStore.listLogs(taskId, "main", false, null, null);
        if (logs.isEmpty()) {
            throw new NotFoundException("任务没有主体阶段日志");
        }

        String dateRange = buildDateRange(logs);
        String logsText = buildLogsText(logs);

        String system = cachedSummarizePrompt;
        String user = Prompts.SUMMARIZE_MAIN_USER
                .replace("{title}", title)
                .replace("{date_range}", dateRange)
                .replace("{logs}", logsText);

        AnthropicResponse resp = callAnthropic(cfg, system, List.of(userMessage(user)));
        String promptText = "[system]\n" + system + "\n\n[user]\n" + user;
        aiRecordStore.addRecord(taskId, null, "summarize", promptText, resp.raw(), false);

        return resp.text();
    }

    // ============================================================
    // 维护期总结
    // ============================================================

    public String summarizeMaintenance(long taskId) {
        LlmConfig cfg = getConfig();
        Map<String, Object> task = taskStore.getTask(taskId);
        String title = (String) task.get("title");

        List<Map<String, Object>> logs = workLogStore.listLogs(taskId, "maintenance", false, null, null);
        if (logs.isEmpty()) {
            throw new NotFoundException("任务没有维护期日志");
        }

        String dateRange = buildDateRange(logs);
        String logsText = buildLogsText(logs);

        String system = cachedSummarizeMaintenancePrompt;
        String user = Prompts.SUMMARIZE_MAINTENANCE_USER
                .replace("{title}", title)
                .replace("{date_range}", dateRange)
                .replace("{logs}", logsText);

        AnthropicResponse resp = callAnthropic(cfg, system, List.of(userMessage(user)));
        String promptText = "[system]\n" + system + "\n\n[user]\n" + user;
        aiRecordStore.addRecord(taskId, null, "summarize", promptText, resp.raw(), false);

        return resp.text();
    }

    // ============================================================
    // 询问维护建议
    // ============================================================

    public String askMaintenance(long taskId) {
        LlmConfig cfg = getConfig();
        Map<String, Object> task = taskStore.getTask(taskId);
        String title = (String) task.get("title");
        String status = (String) task.get("status");

        List<Map<String, Object>> logs = workLogStore.listLogs(taskId, "main", false, null, null);
        if (logs.isEmpty()) {
            throw new NotFoundException("任务没有主体阶段日志");
        }

        String logsText = buildLogsText(logs);

        String system = cachedAskMaintenancePrompt;
        String user = Prompts.ASK_MAINTENANCE_USER
                .replace("{title}", title)
                .replace("{status}", status)
                .replace("{logs}", logsText);

        AnthropicResponse resp = callAnthropic(cfg, system, List.of(userMessage(user)));
        String promptText = "[system]\n" + system + "\n\n[user]\n" + user;
        aiRecordStore.addRecord(taskId, null, "ask_maintenance", promptText, resp.raw(), false);

        return resp.text();
    }

    // ============================================================
    // 通用对话（用于日报/周报导出）
    // ============================================================

    /**
     * 通用对话方法，用于日报/周报生成等场景
     * @param prompt 用户 prompt（包含模板和数据）
     * @return LLM 生成的文本
     */
    public String chat(String prompt) {
        LlmConfig cfg = getConfig();
        String system = "你是中文工作日报生成助手。根据用户提供的模板和数据，生成格式规范的 Markdown 日报/周报内容。严格遵循模板结构，只输出最终内容，不要解释或包裹。";

        AnthropicResponse resp = callAnthropic(cfg, system, List.of(userMessage(prompt)));
        aiRecordStore.addRecord(null, null, "chat", prompt, resp.raw(), false);

        return resp.text();
    }

    // ============================================================
    // SSE 流式聊天
    // ============================================================

    public SseEmitter chatStream(List<Map<String, String>> messages) {
        LlmConfig cfg = getConfig();
        SseEmitter emitter = new SseEmitter(60_000L); // 60s 超时

        executor.submit(() -> {
            try {
                HttpClient client = HttpClient.newHttpClient();
                String systemPrompt = buildChatSystemPrompt();

                // 构建 Anthropic 请求
                var reqBody = Map.of(
                    "model", cfg.model(),
                    "max_tokens", cfg.maxTokens(),
                    "system", systemPrompt,
                    "stream", true,
                    "messages", messages.stream()
                        .map(m -> Map.of(
                            "role", m.get("role"),
                            "content", List.of(Map.of("type", "text", "text", m.get("content")))
                        ))
                        .toList()
                );

                String jsonBody = mapper.writeValueAsString(reqBody);

                HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                        .uri(URI.create(cfg.baseUrl() + "/v1/messages"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(jsonBody));

                // MiniMax 兼容：使用 Bearer 认证，但保留 anthropic-version header
                if (cfg.baseUrl().toLowerCase().contains("minimax")) {
                    reqBuilder.header("Authorization", "Bearer " + cfg.apiKey());
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
                    emitter.send(SseEmitter.event().data("{\"error\":\"LLM 服务异常\"}\n\n"));
                    emitter.complete();
                    return;
                }

                // 解析 SSE 流
                StringBuilder fullText = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(response.body()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (line.startsWith("data: ")) {
                            String data = line.substring(6);
                            if ("[DONE]".equals(data)) {
                                break;
                            }
                            JsonNode event = mapper.readTree(data);
                            String eventType = event.has("type") ? event.get("type").asText() : "";

                            if ("content_block_delta".equals(eventType)) {
                                JsonNode delta = event.path("delta");
                                if ("text_delta".equals(delta.path("type").asText())) {
                                    String text = delta.path("text").asText();
                                    fullText.append(text);
                                    // 转发给前端
                                    String chunk = mapper.writeValueAsString(Map.of("delta", text));
                                    emitter.send(SseEmitter.event().data(chunk));
                                }
                            } else if ("message_stop".equals(eventType)) {
                                break;
                            }
                        }
                    }
                }

                // 发送结束标记
                emitter.send(SseEmitter.event().data("{\"done\":true}"));
                emitter.send(SseEmitter.event().data("[DONE]"));
                emitter.complete();

                // 记录审计
                aiRecordStore.addRecord(null, null, "chat", "chat stream", fullText.toString(), false);

            } catch (LlmNotConfiguredException e) {
                try {
                    emitter.send(SseEmitter.event().data("{\"error\":\"LLM 未配置\"}"));
                    emitter.complete();
                } catch (Exception ignored) {}
            } catch (Exception e) {
                log.error("Chat stream error", e);
                try {
                    emitter.send(SseEmitter.event().data("{\"error\":\"" + e.getMessage() + "\"}"));
                    emitter.completeWithError(e);
                } catch (Exception ignored) {}
            }
        });

        return emitter;
    }

    private String buildChatSystemPrompt() {
        String customPrompt = cachedChatPrompt;
        // 注入当前日期
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

        return nowBlock + customPrompt;
    }

    // ============================================================
    // Anthropic API 调用（同步）
    // ============================================================

    private AnthropicResponse callAnthropic(LlmConfig cfg, String system, List<Map<String, Object>> messages) {
        try {
            HttpClient client = HttpClient.newHttpClient();

            var reqBody = Map.of(
                "model", cfg.model(),
                "max_tokens", cfg.maxTokens(),
                "system", system,
                "messages", messages
            );

            String jsonBody = mapper.writeValueAsString(reqBody);

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(cfg.baseUrl() + "/v1/messages"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody));

            // MiniMax 兼容：使用 Bearer 认证，但保留 anthropic-version header
            if (cfg.baseUrl().toLowerCase().contains("minimax")) {
                reqBuilder.header("Authorization", "Bearer " + cfg.apiKey());
                reqBuilder.header("anthropic-version", ANTHROPIC_VERSION);
            } else {
                reqBuilder.header("x-api-key", cfg.apiKey())
                          .header("anthropic-version", ANTHROPIC_VERSION);
            }

            HttpResponse<String> response = client.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() >= 400) {
                log.error("Anthropic API error: {}", response.body());
                throw new LlmApiException("API 返回 " + response.statusCode() + ": " + response.body());
            }

            JsonNode root = mapper.readTree(response.body());

            // 解析 content blocks
            StringBuilder text = new StringBuilder();
            for (JsonNode block : root.path("content")) {
                String type = block.path("type").asText();
                if ("text".equals(type)) {
                    text.append(block.path("text").asText());
                }
            }

            return new AnthropicResponse(text.toString().trim(), response.body());

        } catch (LlmApiException e) {
            throw e;
        } catch (Exception e) {
            log.error("Anthropic API call failed", e);
            throw new LlmApiException(e.getMessage(), e);
        }
    }

    // ============================================================
    // Helper
    // ============================================================

    private Map<String, Object> userMessage(String text) {
        return Map.of(
            "role", "user",
            "content", List.of(Map.of("type", "text", "text", text))
        );
    }

    private String buildDateRange(List<Map<String, Object>> logs) {
        if (logs.isEmpty()) return "";
        String first = null, last = null;
        for (Map<String, Object> log : logs) {
            Object d = log.get("log_date");
            String date = d != null ? d.toString() : null;
            if (date != null) {
                if (first == null) first = date;
                last = date;
            }
        }
        if (first == null) return "";
        if (first.equals(last)) return first;
        return first + " ~ " + last;
    }

    private String buildLogsText(List<Map<String, Object>> logs) {
        StringBuilder sb = new StringBuilder();
        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd");
        for (Map<String, Object> log : logs) {
            Object d = log.get("log_date");
            String date = d != null ? d.toString() : "";
            String content = (String) log.get("content");
            if (content == null) content = "";
            sb.append("[").append(date).append("] ").append(content).append("\n\n");
        }
        return sb.toString();
    }

    // ============================================================
    // 内部记录
    // ============================================================

    private record LlmConfig(String apiKey, String baseUrl, String model, int maxTokens) {}

    private record AnthropicResponse(String text, String raw) {}
}
