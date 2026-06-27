package com.trail.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trail.config.AppProperties;
import com.trail.store.AiRecordStore;
import com.trail.store.LLMSettingsStore;
import com.trail.store.SkillStore;
import com.trail.store.TaskStore;
import com.trail.store.TodoStore;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;

/**
 * LLM 服务层
 * 封装 Anthropic API 调用逻辑
 * Prompt 模板从数据库加载，默认值在 application.yml 配置
 */
@Service
public class LlmService {

    private static final Logger log = LoggerFactory.getLogger(LlmService.class);
    private static final String ANTHROPIC_VERSION = "2023-06-01";

    // User prompt 模板（包含占位符，不入库）
    private static final String POLISH_USER_TEMPLATE = "请润色以下工作日志：\n\n{content}";
    private static final String SUMMARIZE_MAIN_USER_TEMPLATE = """
        以下是任务「{title}」主体阶段（{date_range}）的工作日志：

        {logs}

        请生成主体阶段总结。
        """;
    private static final String SUMMARIZE_MAINTENANCE_USER_TEMPLATE = """
        以下是任务「{title}」维护期（{date_range}）的日志：

        {logs}

        请生成维护期总结。
        """;
    private static final String ASK_MAINTENANCE_USER_TEMPLATE = """
        任务「{title}」当前状态：{status}。主体阶段日志：

        {logs}

        是否建议进入维护期？
        """;

    private final AppProperties props;
    private final LLMSettingsStore settingsStore;
    private final TaskStore taskStore;
    private final TodoStore todoStore;
    private final WorkLogStore workLogStore;
    private final AiRecordStore aiRecordStore;
    private final SkillStore skillStore;
    private final com.trail.store.VectorStore vectorStore;
    private final EmbeddingService embeddingService;
    private final ObjectMapper mapper;
    private final ExecutorService executor;

    // Prompt 缓存（启动时加载）
    private volatile String cachedPolishPrompt;
    private volatile String cachedPolishTodoPrompt;
    private volatile String cachedPolishTaskDescPrompt;
    private volatile String cachedSummarizePrompt;
    private volatile String cachedSummarizeMaintenancePrompt;
    private volatile String cachedAskMaintenancePrompt;
    private volatile String cachedChatPrompt;
    private volatile String cachedBatchTagPrompt;

    public LlmService(AppProperties props, LLMSettingsStore settingsStore, TaskStore taskStore,
                      TodoStore todoStore, WorkLogStore workLogStore, AiRecordStore aiRecordStore,
                      SkillStore skillStore, com.trail.store.VectorStore vectorStore,
                      EmbeddingService embeddingService) {
        this.props = props;
        this.settingsStore = settingsStore;
        this.taskStore = taskStore;
        this.todoStore = todoStore;
        this.workLogStore = workLogStore;
        this.aiRecordStore = aiRecordStore;
        this.skillStore = skillStore;
        this.vectorStore = vectorStore;
        this.embeddingService = embeddingService;
        this.mapper = new ObjectMapper();
        this.executor = Executors.newCachedThreadPool();

        // Prompt 延迟加载，在首次使用时或 refreshPrompts() 时加载
    }

    /** 从数据库加载 prompt 到内存缓存 */
    private void loadPrompts() {
        Map<String, String> settings = settingsStore.getAll();
        cachedPolishPrompt = settings.get("polish_system_prompt");
        cachedPolishTodoPrompt = settings.get("polish_todo_system_prompt");
        cachedPolishTaskDescPrompt = settings.get("polish_task_desc_system_prompt");
        cachedSummarizePrompt = settings.get("summarize_system_prompt");
        cachedSummarizeMaintenancePrompt = settings.get("summarize_maintenance_prompt");
        cachedAskMaintenancePrompt = settings.get("ask_maintenance_prompt");
        cachedChatPrompt = settings.get("chat_system_prompt");
        cachedBatchTagPrompt = settings.get("batch_tag_system_prompt");
        log.info("Prompt 模板已加载到内存");
    }

    /** 刷新 prompt 缓存（设置保存后调用） */
    public void refreshPrompts() {
        try {
            loadPrompts();
        } catch (Exception e) {
            log.warn("刷新 Prompt 缓存失败: {}", e.getMessage());
        }
    }

    /** 确保缓存已加载 */
    private void ensurePromptsLoaded() {
        if (cachedPolishPrompt == null) {
            loadPrompts();
        }
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
        String defaultBaseUrl = props != null && props.llm() != null
            ? props.llm().getDefaultBaseUrl() : "https://api.anthropic.com";
        String defaultModel = props != null && props.llm() != null
            ? props.llm().getDefaultModel() : "claude-haiku-4-5";
        String baseUrl = settings.getOrDefault("base_url", defaultBaseUrl);
        String model = settings.getOrDefault("model", defaultModel);
        // 认证方式：bearer（默认）或 x-api-key
        String authType = settings.getOrDefault("auth_type", "bearer");
        int maxTokens = 1000;
        String maxTokensStr = settings.get("max_tokens");
        if (maxTokensStr != null && !maxTokensStr.isBlank()) {
            try { maxTokens = Integer.parseInt(maxTokensStr); }
            catch (NumberFormatException ignored) {}
        }
        int minTokens = 0;
        String minTokensStr = settings.get("min_tokens");
        if (minTokensStr != null && !minTokensStr.isBlank()) {
            try { minTokens = Integer.parseInt(minTokensStr); }
            catch (NumberFormatException ignored) {}
        }
        return new LlmConfig(apiKey, baseUrl, model, maxTokens, minTokens, authType);
    }

    // ============================================================
    // 润色
    // ============================================================

    /** 润色文本，支持三种类型：log（日志）、todo（待办）、task_desc（任务描述） */
    public String polish(String content, Long taskId, String type) {
        ensurePromptsLoaded();
        LlmConfig cfg = getConfig();

        String system;
        if ("todo".equals(type)) {
            system = cachedPolishTodoPrompt;
        } else if ("task_desc".equals(type)) {
            system = cachedPolishTaskDescPrompt;
        } else {
            system = cachedPolishPrompt;
        }
        String polishScope = "todo".equals(type) ? "polish_todo"
                           : "task_desc".equals(type) ? "polish_task"
                           : "polish_log";
        system = appendSkills(system, polishScope);

        // 自动注入任务上下文
        if (taskId != null) {
            try {
                Map<String, Object> task = taskStore.getTask(taskId);
                String title = task.get("title") != null ? task.get("title").toString() : "";
                String desc  = task.get("description") != null ? task.get("description").toString() : "";

                if ("task_desc".equals(type)) {
                    String[] parts = buildTaskDescParts(system, cfg, taskId, title, desc);
                    system = parts[0];
                    // 把任务上下文追加到 user prompt
                    String userContext = parts[1];
                    String user = POLISH_USER_TEMPLATE.replace("{content}", content)
                        + (userContext.isBlank() ? "" : "\n\n---\n【参考背景（仅用于理解任务范围，禁止复述其中任何细节内容）】\n" + userContext);
                    AnthropicResponse resp = callAnthropic(cfg, system, List.of(userMessage(user)));
                    String promptText = "[system]\n" + system + "\n\n[user]\n" + user;
                    aiRecordStore.addRecord(taskId, null, "polish", promptText, resp.raw(), false);
                    return cleanTaskDesc(resp.text());

                } else {
                    // log / todo：注入任务标题和描述
                    if (system.contains("{task_title}") || system.contains("{task_desc}")) {
                        system = system.replace("{task_title}", title).replace("{task_desc}", desc);
                    } else if (!title.isBlank()) {
                        system = system + "\n\n当前任务：「" + title + "」"
                               + (desc.isBlank() ? "" : "\n任务描述：" + desc);
                    }
                }
            } catch (Exception ignored) {}
        }

        String user = POLISH_USER_TEMPLATE.replace("{content}", content);
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
        ensurePromptsLoaded();
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
        String user = SUMMARIZE_MAIN_USER_TEMPLATE
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
        ensurePromptsLoaded();
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
        String user = SUMMARIZE_MAINTENANCE_USER_TEMPLATE
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
        ensurePromptsLoaded();
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
        String user = ASK_MAINTENANCE_USER_TEMPLATE
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

    // ============================================================
    // 对话式润色（SSE 流式）
    // ============================================================

    /**
     * 对话式润色流接口：结合任务上下文，以多轮对话方式引导用户完成内容润色。
     * type: log（日报）| todo（待办说明）| task_desc（任务描述）
     * messages: 前端传来的完整对话历史（role=user/assistant）
     * content: 原始内容（仅首轮触发时传入，后续多轮从 messages 恢复）
     * taskId: 可选，用于注入任务上下文
     */
    public SseEmitter polishDialogStream(String type, String content, Long taskId,
                                         List<Map<String, String>> messages) {
        ensurePromptsLoaded();
        LlmConfig cfg = getConfig();
        SseEmitter emitter = new SseEmitter(120_000L);

        executor.submit(() -> {
            try {
                // 选择基础提示词
                String baseSystem;
                if ("todo".equals(type)) {
                    baseSystem = cachedPolishTodoPrompt;
                } else if ("task_desc".equals(type)) {
                    baseSystem = cachedPolishTaskDescPrompt;
                } else {
                    baseSystem = cachedPolishPrompt;
                }
                if (baseSystem == null || baseSystem.isBlank()) {
                    baseSystem = switch (type) {
                        case "todo"      -> "你是待办说明润色助手。";
                        case "task_desc" -> "你是任务描述润色助手。";
                        default          -> "你是工作日报润色助手。";
                    };
                }

                // 注入任务上下文
                if (taskId != null) {
                    try {
                        Map<String, Object> task = taskStore.getTask(taskId);
                        String title = task.get("title") != null ? task.get("title").toString() : "";
                        String desc  = task.get("description") != null ? task.get("description").toString() : "";
                        if (!title.isBlank()) {
                            baseSystem = baseSystem + "\n\n当前任务：「" + title + "」"
                                + (desc.isBlank() ? "" : "\n任务描述：" + desc);
                        }
                    } catch (Exception ignored) {}
                }

                // 预先计算查询向量，供待办和日报 RAG 共用（避免重复 embed）
                float[] ragQueryVec = null;
                if (taskId != null && embeddingService.isEnabled() && !content.isBlank()) {
                    try { ragQueryVec = embeddingService.embed(content); } catch (Exception ignored) {}
                }

                // ── 显式引用的待办（@todo:N）────────────────────────────
                if (taskId != null) {
                    try {
                        java.util.regex.Matcher em =
                            java.util.regex.Pattern.compile("@todo:(\\d+)").matcher(content);
                        java.util.Set<Long> explicitTodoIds = new java.util.LinkedHashSet<>();
                        while (em.find()) explicitTodoIds.add(Long.parseLong(em.group(1)));

                        if (!explicitTodoIds.isEmpty()) {
                            StringBuilder todoBuf = new StringBuilder("\n\n【日报引用的待办】\n");
                            for (Long tid : explicitTodoIds) {
                                try {
                                    Map<String, Object> t = todoStore.getTodo(tid);
                                    String todoTitle = t.get("title") != null ? t.get("title").toString() : "";
                                    boolean done = Boolean.TRUE.equals(t.get("is_completed")) ||
                                                   (t.get("is_completed") instanceof Number n2 && n2.intValue() == 1);
                                    boolean abandoned = Boolean.TRUE.equals(t.get("is_abandoned")) ||
                                                        (t.get("is_abandoned") instanceof Number n2 && n2.intValue() == 1);
                                    String st = done ? "✓ 已完成" : abandoned ? "✗ 已废弃" : "○ 进行中";
                                    todoBuf.append("- [").append(st).append("] ").append(todoTitle).append("\n");
                                } catch (Exception ignored2) {}
                            }
                            baseSystem = baseSystem + todoBuf;
                        }
                    } catch (Exception ignored) {}
                }

                // ── RAG：向量检索同任务相关历史日报 ─────────────────────
                if (taskId != null && ragQueryVec != null) {
                    try {
                        final long ragTaskId = taskId;
                        List<com.trail.store.VectorStore.SearchResult> hits =
                            vectorStore.search(ragQueryVec, 30);

                        // 过滤：同任务的 log，相似度 >= 0.5，取前 5 条
                        List<Map<String, Object>> ragLogs = new java.util.ArrayList<>();
                        for (com.trail.store.VectorStore.SearchResult h : hits) {
                            if (!"log".equals(h.source())) continue;
                            if (h.score() < 0.5f) break; // 已按分数降序
                            String idPart = h.id().contains(":") ? h.id().split(":", 2)[1] : null;
                            if (idPart == null) continue;
                            try {
                                long logId = Long.parseLong(idPart);
                                Map<String, Object> logRow = workLogStore.getLog(logId);
                                Object logTaskIdObj = logRow.get("task_id");
                                if (logTaskIdObj == null) continue;
                                long logTaskId = ((Number) logTaskIdObj).longValue();
                                if (logTaskId != ragTaskId) continue;
                                logRow.put("_score", h.score());
                                ragLogs.add(logRow);
                                if (ragLogs.size() >= 5) break;
                            } catch (Exception ignored2) {}
                        }

                        if (!ragLogs.isEmpty()) {
                            // 批量收集 @todo/@task ID 用于展开
                            java.util.regex.Pattern mentionPat =
                                java.util.regex.Pattern.compile("@(todo|task):(\\d+)");
                            java.util.Set<Long> todoIds = new java.util.LinkedHashSet<>();
                            java.util.Set<Long> taskIds2 = new java.util.LinkedHashSet<>();
                            for (Map<String, Object> lr : ragLogs) {
                                String c = lr.get("content") != null ? lr.get("content").toString() : "";
                                java.util.regex.Matcher m2 = mentionPat.matcher(c);
                                while (m2.find()) {
                                    long mid = Long.parseLong(m2.group(2));
                                    if ("todo".equals(m2.group(1))) todoIds.add(mid);
                                    else taskIds2.add(mid);
                                }
                            }
                            // 批量查标题
                            Map<Long, String> todoTitles = new java.util.LinkedHashMap<>();
                            if (!todoIds.isEmpty()) {
                                String ph = todoIds.stream().map(id -> "?").collect(java.util.stream.Collectors.joining(","));
                                List<Map<String, Object>> tRows = todoStore.listTodos(ragTaskId);
                                tRows.forEach(r2 -> {
                                    long tid = ((Number) r2.get("id")).longValue();
                                    if (todoIds.contains(tid))
                                        todoTitles.put(tid, r2.get("title") != null ? r2.get("title").toString() : "");
                                });
                            }
                            Map<Long, String> relTaskTitles = taskIds2.isEmpty()
                                ? java.util.Collections.emptyMap()
                                : taskStore.getTaskTitles(new java.util.ArrayList<>(taskIds2));

                            // 展开 @mention 并拼 RAG 块
                            StringBuilder ragBuf = new StringBuilder("\n\n【参考：同任务相关历史日报（仅供风格和背景参考）】\n");
                            for (Map<String, Object> lr : ragLogs) {
                                String logDate = lr.get("log_date") != null ? lr.get("log_date").toString() : "";
                                String rawContent = lr.get("content") != null ? lr.get("content").toString() : "";
                                // 展开 @mention
                                StringBuffer expanded = new StringBuffer();
                                java.util.regex.Matcher m3 = mentionPat.matcher(rawContent);
                                while (m3.find()) {
                                    String mType = m3.group(1);
                                    long mId = Long.parseLong(m3.group(2));
                                    String mTitle = "todo".equals(mType)
                                        ? todoTitles.get(mId) : relTaskTitles.get(mId);
                                    String replacement = mTitle != null
                                        ? "@" + mType + ":" + mId + "「" + mTitle + "」"
                                        : m3.group(0);
                                    m3.appendReplacement(expanded,
                                        java.util.regex.Matcher.quoteReplacement(replacement));
                                }
                                m3.appendTail(expanded);
                                ragBuf.append("- [").append(logDate).append("] ")
                                      .append(expanded).append("\n");
                            }
                            baseSystem = baseSystem + ragBuf;
                        }
                    } catch (Exception ragEx) {
                        log.debug("RAG 检索跳过: {}", ragEx.getMessage());
                    }
                }

                // 对话式润色引导规则
                String dialogRules = """

                    ---
                    【对话式润色规则】
                    你的目标是通过对话帮助用户完成内容润色，而不是直接替换原文。

                    **第一轮行为（当用户首次发送内容时）：**
                    1. 简要分析原文存在的问题（2-4条，具体指出哪里不足，例如"第二句缺少主语"、"表达过于口语化"）
                    2. 提出 1-2 个改进方向，或询问用户的侧重点
                    3. 不要直接给出完整润色版本，先等用户反馈

                    **后续轮次：**
                    - 根据用户回复调整方向
                    - 当用户同意或明确要求生成时，给出最终建议版本
                    - 最终建议版本必须用以下格式包裹（方便前端识别）：

                    【建议版本】
                    ```
                    （润色后的完整内容）
                    ```

                    **重要：**
                    - 用第一人称分析（"我注意到…"、"这里可以…"）
                    - 每次只关注最重要的 2-3 个改进点，不要列一大堆
                    - 保留用户原有的事实和数字，不要添加用户没写过的信息
                    """;

                String systemPrompt = baseSystem + dialogRules;

                // 构建 API messages（将 role=user/assistant 对话历史直接传递）
                List<Map<String, Object>> apiMessages = messages.stream()
                    .map(m -> {
                        Map<String, Object> msg = new java.util.LinkedHashMap<>();
                        msg.put("role", m.get("role"));
                        msg.put("content", List.of(Map.of("type", "text", "text", m.get("content"))));
                        return msg;
                    })
                    .toList();

                HttpClient client = HttpClient.newHttpClient();
                var reqBody = new java.util.LinkedHashMap<String, Object>();
                reqBody.put("model", cfg.model());
                reqBody.put("max_tokens", cfg.maxTokens());
                if (cfg.minTokens() > 0) reqBody.put("min_tokens", cfg.minTokens());
                reqBody.put("system", systemPrompt);
                reqBody.put("stream", true);
                reqBody.put("messages", apiMessages);

                String jsonBody = mapper.writeValueAsString(reqBody);
                HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(cfg.baseUrl() + "/v1/messages"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody));

                if ("x-api-key".equals(cfg.authType())) {
                    reqBuilder.header("x-api-key", cfg.apiKey())
                              .header("anthropic-version", ANTHROPIC_VERSION);
                } else {
                    reqBuilder.header("Authorization", "Bearer " + cfg.apiKey())
                              .header("anthropic-version", ANTHROPIC_VERSION);
                }

                HttpResponse<java.io.InputStream> response = client.send(
                    reqBuilder.build(), HttpResponse.BodyHandlers.ofInputStream());

                if (response.statusCode() >= 400) {
                    String errorBody = new String(response.body().readAllBytes());
                    log.error("Polish dialog stream error: {}", errorBody);
                    emitter.send(SseEmitter.event().data("{\"error\":\"LLM 服务异常\"}\n\n"));
                    emitter.complete();
                    return;
                }

                StringBuilder fullText = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(response.body()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (line.startsWith("data: ")) {
                            String data = line.substring(6);
                            if ("[DONE]".equals(data)) break;
                            JsonNode event = mapper.readTree(data);
                            String eventType = event.has("type") ? event.get("type").asText() : "";
                            if ("content_block_delta".equals(eventType)) {
                                JsonNode delta = event.path("delta");
                                if ("text_delta".equals(delta.path("type").asText())) {
                                    String text = delta.path("text").asText();
                                    fullText.append(text);
                                    emitter.send(SseEmitter.event().data(mapper.writeValueAsString(Map.of("delta", text))));
                                }
                            } else if ("message_stop".equals(eventType)) {
                                break;
                            }
                        }
                    }
                }

                emitter.send(SseEmitter.event().data("{\"done\":true}"));
                emitter.send(SseEmitter.event().data("[DONE]"));
                emitter.complete();
                aiRecordStore.addRecord(taskId, null, "polish_dialog", "polish dialog stream", fullText.toString(), false);

            } catch (LlmNotConfiguredException e) {
                try { emitter.send(SseEmitter.event().data("{\"error\":\"LLM 未配置\"}")); emitter.complete(); } catch (Exception ignored) {}
            } catch (Exception e) {
                log.error("Polish dialog stream error", e);
                try { emitter.send(SseEmitter.event().data("{\"error\":\"" + e.getMessage() + "\"}")); emitter.completeWithError(e); } catch (Exception ignored) {}
            }
        });

        return emitter;
    }

    public SseEmitter chatStream(List<Map<String, String>> messages) {
        LlmConfig cfg = getConfig();
        SseEmitter emitter = new SseEmitter(60_000L); // 60s 超时

        executor.submit(() -> {
            try {
                HttpClient client = HttpClient.newHttpClient();
                String systemPrompt = buildChatSystemPrompt();

                // 构建 Anthropic 请求
                var reqBody = new java.util.LinkedHashMap<String, Object>();
                reqBody.put("model", cfg.model());
                reqBody.put("max_tokens", cfg.maxTokens());
                if (cfg.minTokens() > 0) {
                    reqBody.put("min_tokens", cfg.minTokens());
                }
                reqBody.put("system", systemPrompt);
                reqBody.put("stream", true);
                reqBody.put("messages", messages.stream()
                        .map(m -> Map.of(
                            "role", m.get("role"),
                            "content", List.of(Map.of("type", "text", "text", m.get("content")))
                        ))
                        .toList());

                String jsonBody = mapper.writeValueAsString(reqBody);

                HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                        .uri(URI.create(cfg.baseUrl() + "/v1/messages"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(jsonBody));

                // 根据 auth_type 配置选择认证方式
                // bearer: Authorization: Bearer <key>（智谱、DeepSeek、MiniMax 等）
                // x-api-key: x-api-key: <key>（Anthropic 原生）
                if ("x-api-key".equals(cfg.authType())) {
                    reqBuilder.header("x-api-key", cfg.apiKey())
                              .header("anthropic-version", ANTHROPIC_VERSION);
                } else {
                    // 默认 bearer 认证
                    reqBuilder.header("Authorization", "Bearer " + cfg.apiKey());
                    reqBuilder.header("anthropic-version", ANTHROPIC_VERSION);
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
        ensurePromptsLoaded();
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

            var reqBody = new java.util.LinkedHashMap<String, Object>();
            reqBody.put("model", cfg.model());
            reqBody.put("max_tokens", cfg.maxTokens());
            if (cfg.minTokens() > 0) {
                reqBody.put("min_tokens", cfg.minTokens());
            }
            reqBody.put("system", system);
            reqBody.put("messages", messages);

            String jsonBody = mapper.writeValueAsString(reqBody);

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(cfg.baseUrl() + "/v1/messages"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody));

            // 根据 auth_type 配置选择认证方式
            // bearer: Authorization: Bearer <key>（智谱、DeepSeek、MiniMax 等）
            // x-api-key: x-api-key: <key>（Anthropic 原生）
            if ("x-api-key".equals(cfg.authType())) {
                reqBuilder.header("x-api-key", cfg.apiKey())
                          .header("anthropic-version", ANTHROPIC_VERSION);
            } else {
                // 默认 bearer 认证
                reqBuilder.header("Authorization", "Bearer " + cfg.apiKey());
                reqBuilder.header("anthropic-version", ANTHROPIC_VERSION);
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

    private static final int LOG_CHUNK_SIZE = 15;

    private static final String CHUNK_SUMMARY_SYSTEM =
        "你是任务进展提炼助手。任务「{task_title}」的工作日志片段如下，" +
        "提炼关键工作职责和推进方向，精炼准确，不要逐条复述。" +
        "只描述做了哪类工作、达成了什么目标，不要出现具体的故障名称、系统参数、错误信息、数据量等技术细节。";

    private static final String FINAL_SUMMARY_SYSTEM =
        "你是任务进展提炼助手。以下是任务「{task_title}」的各阶段进展摘要，" +
        "请综合提炼为一段完整的任务进展总结，精炼准确，去除重复。" +
        "只描述工作职责和任务方向，不要出现具体的故障名称、系统参数、错误信息、数据量等技术细节。";

    private static final String BATCH_PARSE_SYSTEM = """
        你是工作日志拆分助手。用户会粘贴一段包含多项工作内容的文字，你需要将其拆分为独立的工作日志条目。

        规则：
        1. 根据内容判断每段文字属于哪个任务（从给定任务列表中选择最匹配的）
        2. 如果某段内容无法匹配任何任务，task_title 填 null
        3. hours 根据内容估算工时（0.5~8，没有明确说明时填 1.0）
        4. content 保留原文，不要润色，不要删减
        5. 必须返回合法 JSON 数组，不要包含任何其他文字

        返回格式（JSON 数组）：
        [
          {"task_title": "任务名称", "content": "日志内容", "hours": 1.5},
          ...
        ]
        """;

    private static final String BATCH_TAG_SYSTEM = """
        你是工作日志标注助手。用户会粘贴一段包含多项工作内容的文字，请按任务对内容分组，在每个任务内容块的**最开头**插入一次 `@task:ID` 标记。

        规则：
        1. 任务列表由用户提供，格式为 "ID: 任务名称"
        2. 阅读全文，判断哪些连续的行/句子属于同一个任务，将它们视为一个内容块
        3. 每个内容块只在**最开头**插入一次 `@task:ID`（ID 替换为实际数字），后跟换行，块内其余行不重复插入
        4. 如果某段内容无法匹配任何任务，不加任何标记，原样保留
        5. 不要修改原文任何内容，不要润色，不要删减，不要添加任何解释
        6. 只输出打标后的完整文本，不要包含任何其他文字

        示例输入：
        修复了登录页面的 bug
        调整了按钮样式
        完成了数据库迁移脚本
        测试了迁移结果

        示例输出（假设任务1=前端优化，任务2=数据库迁移）：
        @task:1
        修复了登录页面的 bug
        调整了按钮样式
        @task:2
        完成了数据库迁移脚本
        测试了迁移结果
        """;

    public String batchTagLogs(String rawText, List<Map<String, Object>> tasks) {
        ensurePromptsLoaded();
        LlmConfig cfg = getConfig();
        String system = cachedBatchTagPrompt != null ? cachedBatchTagPrompt : BATCH_TAG_SYSTEM;
        String taskListText = tasks.isEmpty() ? "（无）"
            : tasks.stream()
                .map(t -> t.get("id") + ": " + t.get("title"))
                .collect(java.util.stream.Collectors.joining("\n"));

        // 向量匹配提示：语义最近的任务优先推荐给 LLM
        String vectorHint = "";
        if (embeddingService.isEnabled() && !rawText.isBlank()) {
            try {
                float[] vec = embeddingService.embed(rawText);
                List<com.trail.store.VectorStore.SearchResult> hits = vectorStore.search(vec, 30);

                Map<Long, String> taskTitleMap = new java.util.HashMap<>();
                for (Map<String, Object> t : tasks) {
                    if (t.get("id") != null)
                        taskTitleMap.put(((Number) t.get("id")).longValue(),
                                         t.get("title") != null ? t.get("title").toString() : "");
                }

                // 按 task_id 聚合最高分（来自 log 和 task 两种 source）
                Map<Long, Double> taskScores = new java.util.LinkedHashMap<>();
                for (com.trail.store.VectorStore.SearchResult h : hits) {
                    if (h.score() < 0.4f) break;
                    String idPart = h.id().contains(":") ? h.id().split(":", 2)[1] : null;
                    if (idPart == null) continue;
                    try {
                        long entityId = Long.parseLong(idPart);
                        long taskId;
                        if ("task".equals(h.source())) {
                            taskId = entityId;
                        } else if ("log".equals(h.source())) {
                            Map<String, Object> logRow = workLogStore.getLog(entityId);
                            Object tid = logRow.get("task_id");
                            if (tid == null) continue;
                            taskId = ((Number) tid).longValue();
                        } else {
                            continue;
                        }
                        if (!taskTitleMap.containsKey(taskId)) continue;
                        taskScores.merge(taskId, (double) h.score(), Math::max);
                    } catch (Exception ignored2) {}
                }

                if (!taskScores.isEmpty()) {
                    String hints = taskScores.entrySet().stream()
                        .sorted((a, b) -> Double.compare(b.getValue(), a.getValue()))
                        .limit(5)
                        .map(e -> "  task:" + e.getKey() + "「" + taskTitleMap.get(e.getKey())
                                  + "」相似度:" + String.format("%.2f", e.getValue()))
                        .collect(java.util.stream.Collectors.joining("\n"));
                    if (!hints.isBlank()) {
                        vectorHint = "\n\n【向量检索提示（语义最相关任务，供参考）】\n" + hints;
                    }
                }
            } catch (Exception e) {
                log.debug("batch-tag 向量检索跳过: {}", e.getMessage());
            }
        }

        String user = "当前任务列表（格式：ID: 名称）：\n" + taskListText
            + vectorHint
            + "\n\n以下是需要标注的工作内容：\n\n" + rawText;
        AnthropicResponse resp = callAnthropic(cfg, system, List.of(userMessage(user)));
        aiRecordStore.addRecord(null, null, "batch_tag", user, resp.raw(), false);
        return resp.text();
    }

    public List<Map<String, Object>> parseBatchLogs(String rawText, List<String> taskTitles) {
        LlmConfig cfg = getConfig();
        String titlesText = taskTitles.isEmpty() ? "（无）" : String.join("\n", taskTitles.stream().map(t -> "- " + t).toList());
        String user = "当前进行中的任务列表：\n" + titlesText + "\n\n以下是需要拆分的工作内容：\n\n" + rawText;
        AnthropicResponse resp = callAnthropic(cfg, BATCH_PARSE_SYSTEM, List.of(userMessage(user)));
        aiRecordStore.addRecord(null, null, "batch_parse", user, resp.raw(), false);
        try {
            String json = stripCodeBlocks(resp.text());
            JsonNode arr = mapper.readTree(json);
            List<Map<String, Object>> result = new ArrayList<>();
            for (JsonNode node : arr) {
                java.util.LinkedHashMap<String, Object> item = new java.util.LinkedHashMap<>();
                item.put("task_title", node.path("task_title").isNull() ? null : node.path("task_title").asText());
                item.put("content",    node.path("content").asText(""));
                item.put("hours",      node.path("hours").asDouble(1.0));
                result.add(item);
            }
            return result;
        } catch (Exception e) {
            log.warn("parseBatchLogs JSON parse failed, raw: {}", resp.text(), e);
            throw new LlmApiException("LLM 返回格式异常，请重试");
        }
    }

    /** 过滤 Markdown 代码块（``` ... ```） */
    private String stripCodeBlocks(String text) {
        if (text == null) return "";
        return text.replaceAll("(?s)```.*?```", "").trim();
    }

    /**
     * 清理 task_desc 润色结果：
     * 1. 去掉 Markdown 标题（### / ## / #）
     * 2. 去掉加粗（**text** → text）
     * 3. 去掉水平分割线（--- / ***）
     * 4. 把列表项（- xxx 或 数字. xxx）转为普通行
     * 5. 去掉末尾客套话（"如需…" "欢迎…" "请告知…" 等）
     * 6. 合并多余空行
     */
    private String cleanTaskDesc(String text) {
        if (text == null) return "";
        // 去掉 Markdown 标题
        text = text.replaceAll("(?m)^#{1,6}\\s+", "");
        // 去掉加粗/斜体
        text = text.replaceAll("\\*{1,2}([^*]+)\\*{1,2}", "$1");
        // 去掉水平分割线
        text = text.replaceAll("(?m)^[-*]{3,}\\s*$", "");
        // 列表项 "- " 或 "* " 或 "数字. " 开头，去掉符号保留内容
        text = text.replaceAll("(?m)^[-*]\\s+", "");
        text = text.replaceAll("(?m)^\\d+\\.\\s+", "");
        // 去掉末尾客套话（最后一段包含"如需""欢迎""请告知""随时"等）
        text = text.replaceAll("(?m)^[^\n]*(?:如需|欢迎|请告知|随时|如果需要|可以随时|如有)[^\n]*$", "").trim();
        // 合并多余空行（超过2个换行压缩为1个空行）
        text = text.replaceAll("\n{3,}", "\n\n").trim();
        return text;
    }

    /**
     * 为 task_desc 润色准备 system prompt 和 user 侧上下文。
     * 返回 String[2]：[0] = system, [1] = user context（摘要放 user 侧，避免 LLM 照搬）
     */
    private String[] buildTaskDescParts(String systemTpl, LlmConfig cfg,
                                         long taskId, String title, String desc) {
        // 1. 全量日志，时间正序
        List<Map<String, Object>> allLogs = workLogStore.listLogs(taskId, null, false, null, null, null, "asc");
        allLogs = workLogStore.enrichLogs(allLogs);

        String logSummary;
        if (allLogs.isEmpty()) {
            logSummary = "（暂无日志）";
        } else {
            List<List<Map<String, Object>>> chunks = new ArrayList<>();
            for (int i = 0; i < allLogs.size(); i += LOG_CHUNK_SIZE) {
                chunks.add(allLogs.subList(i, Math.min(i + LOG_CHUNK_SIZE, allLogs.size())));
            }

            String chunkSystem = CHUNK_SUMMARY_SYSTEM.replace("{task_title}", title);
            List<String> chunkSummaries = new ArrayList<>();
            for (List<Map<String, Object>> chunk : chunks) {
                StringBuilder sb = new StringBuilder();
                for (Map<String, Object> log : chunk) {
                    String date = log.get("log_date") != null ? log.get("log_date").toString() : "";
                    String content = stripCodeBlocks(
                        log.get("content") != null ? log.get("content").toString() : "");
                    if (!content.isBlank()) {
                        sb.append("[").append(date).append("] ").append(content).append("\n\n");
                    }
                }
                if (sb.isEmpty()) continue;
                AnthropicResponse r = callAnthropic(cfg, chunkSystem, List.of(userMessage(sb.toString())));
                chunkSummaries.add(r.text());
            }

            if (chunkSummaries.isEmpty()) {
                logSummary = "（暂无日志）";
            } else if (chunkSummaries.size() == 1) {
                logSummary = chunkSummaries.get(0);
            } else {
                String merged = String.join("\n\n---\n\n", chunkSummaries);
                String finalSystem = FINAL_SUMMARY_SYSTEM.replace("{task_title}", title);
                AnthropicResponse r = callAnthropic(cfg, finalSystem, List.of(userMessage(merged)));
                logSummary = r.text();
            }
        }

        // 2. 待办（含描述，过滤代码块）
        List<Map<String, Object>> activeTodos = todoStore.listTodos(taskId).stream()
            .filter(t -> Integer.valueOf(0).equals(t.get("is_completed"))
                      && Integer.valueOf(0).equals(t.get("is_abandoned")))
            .toList();
        String todosText = activeTodos.isEmpty() ? "（暂无待办）"
            : activeTodos.stream().map(t -> {
                String todoTitle = t.get("title") != null ? t.get("title").toString() : "";
                String todoDesc = t.get("description") != null
                    ? stripCodeBlocks(t.get("description").toString()) : "";
                return "- " + todoTitle + (todoDesc.isBlank() ? "" : "（" + todoDesc + "）");
            }).collect(Collectors.joining("\n"));

        // 3. system：只做占位符替换
        if (systemTpl.contains("{task_title}")) systemTpl = systemTpl.replace("{task_title}", title);
        if (systemTpl.contains("{task_desc}")) systemTpl = systemTpl.replace("{task_desc}", desc);
        if (systemTpl.contains("{log_summary}")) systemTpl = systemTpl.replace("{log_summary}", logSummary);
        if (systemTpl.contains("{todos}")) systemTpl = systemTpl.replace("{todos}", todosText);

        // 4. user context：摘要放 user 侧
        String userContext = "任务名称：「" + title + "」"
            + (desc.isBlank() ? "" : "\n历史描述：" + desc)
            + "\n工作进展摘要：\n" + logSummary
            + "\n未完成待办：\n" + todosText;

        return new String[]{ systemTpl, userContext };
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
    // Skills 注入
    // ============================================================

    private String appendSkills(String base, String scope) {
        try {
            List<Map<String, Object>> skills = skillStore.findEnabledByScope(scope);
            if (skills.isEmpty()) return base;
            StringBuilder sb = new StringBuilder(base != null ? base : "");
            for (Map<String, Object> skill : skills) {
                String snippet = (String) skill.get("system_prompt");
                if (snippet != null && !snippet.isBlank()) {
                    sb.append("\n\n---\n\n").append(snippet.strip());
                }
            }
            return sb.toString();
        } catch (Exception e) {
            log.warn("appendSkills({}) 失败: {}", scope, e.getMessage());
            return base;
        }
    }

    // ============================================================
    // 内部记录
    // ============================================================

    private record LlmConfig(String apiKey, String baseUrl, String model, int maxTokens, int minTokens, String authType) {}

    private record AnthropicResponse(String text, String raw) {}
}
