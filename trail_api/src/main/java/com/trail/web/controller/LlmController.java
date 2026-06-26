package com.trail.web.controller;

import com.trail.service.ChatWithToolsService;
import com.trail.service.LlmService;
import com.trail.store.TaskStore;
import com.trail.store.WorkLogStore;
import com.trail.web.dto.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Map;

/**
 * LLM 端点
 */
@RestController
@RequestMapping("/api")
@Tag(name = "LLM 服务", description = "大模型相关功能：润色、总结、聊天")
public class LlmController {

    private final LlmService llmService;
    private final ChatWithToolsService chatWithToolsService;
    private final WorkLogStore workLogStore;
    private final TaskStore taskStore;

    public LlmController(LlmService llmService, ChatWithToolsService chatWithToolsService,
                         WorkLogStore workLogStore, TaskStore taskStore) {
        this.llmService = llmService;
        this.chatWithToolsService = chatWithToolsService;
        this.workLogStore = workLogStore;
        this.taskStore = taskStore;
    }

    @Operation(summary = "润色文本", description = "将口语化文本润色为书面化表达")
    @PostMapping("/llm/polish")
    public LlmPolishResponse polish(@RequestBody LlmPolishRequest req) {
        String type = req.type() != null ? req.type() : "log";
        String polished = llmService.polish(req.content(), req.task_id(), type);
        return new LlmPolishResponse(polished, false);
    }

    @Operation(summary = "润色已落档日志", description = "润色指定日志的内容")
    @PostMapping("/tasks/{taskId}/logs/{logId}/polish")
    public LlmPolishResponse polishLogged(@PathVariable Long taskId, @PathVariable Long logId) {
        Map<String, Object> log = workLogStore.getLog(logId);
        String content = (String) log.get("content");
        String polished = llmService.polish(content, taskId);
        return new LlmPolishResponse(polished, false);
    }

    @Operation(summary = "生成日志草稿", description = "根据粗糙描述和任务上下文生成工作日志草稿")
    @PostMapping("/tasks/{taskId}/logs/draft")
    public LlmPolishResponse draftLog(
            @PathVariable Long taskId,
            @RequestBody java.util.Map<String, String> body) {
        String hint = body.getOrDefault("hint", "");
        if (hint.isBlank()) throw new IllegalArgumentException("hint 不能为空");
        String draft = llmService.draftLog(taskId, hint);
        return new LlmPolishResponse(draft, false);
    }

    @Operation(summary = "主体阶段总结", description = "总结任务主体阶段的工作内容")
    @PostMapping("/tasks/{taskId}/summarize")
    public LlmSummarizeResponse summarizeMain(@PathVariable Long taskId) {
        String text = llmService.summarizeMain(taskId);
        return new LlmSummarizeResponse(text);
    }

    @Operation(summary = "维护期总结", description = "总结任务维护阶段的工作内容")
    @PostMapping("/tasks/{taskId}/maintenance/summarize")
    public LlmSummarizeResponse summarizeMaintenance(@PathVariable Long taskId) {
        String text = llmService.summarizeMaintenance(taskId);
        return new LlmSummarizeResponse(text);
    }

    @Operation(summary = "询问维护建议", description = "判断任务是否应进入维护期")
    @PostMapping("/tasks/{taskId}/ask-maintenance")
    public LlmAskMaintenanceResponse askMaintenance(@PathVariable Long taskId) {
        String suggestion = llmService.askMaintenance(taskId);
        return new LlmAskMaintenanceResponse(suggestion);
    }

    @Operation(summary = "批量日志打标", description = "AI 在原文中插入 @task:ID 标记，原文内容不变")
    @PostMapping("/llm/batch-tag")
    public Map<String, String> batchTag(@RequestBody Map<String, Object> body) {
        String text = (String) body.getOrDefault("text", "");
        if (text.isBlank()) throw new IllegalArgumentException("text 不能为空");
        List<Map<String, Object>> tasks = taskStore.listTasks(null, null, null);
        String tagged = llmService.batchTagLogs(text, tasks);
        return Map.of("text", tagged);
    }

    @Operation(summary = "批量日志解析", description = "将一段包含多项工作内容的文字，通过 LLM 拆分为按任务归类的日志条目列表")
    @PostMapping("/llm/batch-parse")
    public List<Map<String, Object>> batchParse(@RequestBody Map<String, Object> body) {
        String text = (String) body.getOrDefault("text", "");
        if (text.isBlank()) throw new IllegalArgumentException("text 不能为空");
        @SuppressWarnings("unchecked")
        List<String> taskTitles = (List<String>) body.getOrDefault("task_titles", List.of());
        return llmService.parseBatchLogs(text, taskTitles);
    }

    @Operation(summary = "基础聊天（SSE）", description = "流式聊天，无工具调用")
    @PostMapping(value = "/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter chatStream(@RequestBody ChatRequest req) {
        List<Map<String, String>> messages = req.messages().stream()
                .map(m -> Map.of("role", m.role(), "content", m.content()))
                .toList();
        return llmService.chatStream(messages);
    }

    @Operation(summary = "工具调用聊天（SSE）", description = "流式聊天，支持 LLM 调用工具查询数据")
    @PostMapping(value = "/chat/tools/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter chatStreamWithTools(@RequestBody ChatRequest req) {
        List<Map<String, String>> messages = req.messages().stream()
                .map(m -> Map.of("role", m.role(), "content", m.content()))
                .toList();
        return chatWithToolsService.chatStreamWithTools(messages);
    }
}
