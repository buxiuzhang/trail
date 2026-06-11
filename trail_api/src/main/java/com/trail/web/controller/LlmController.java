package com.trail.web.controller;

import com.trail.service.LlmService;
import com.trail.store.WorkLogStore;
import com.trail.store.exception.NotFoundException;
import com.trail.web.dto.*;
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
public class LlmController {

    private final LlmService llmService;
    private final WorkLogStore workLogStore;

    public LlmController(LlmService llmService, WorkLogStore workLogStore) {
        this.llmService = llmService;
        this.workLogStore = workLogStore;
    }

    // ============================================================
    // 润色
    // ============================================================

    /** 落档前润色 */
    @PostMapping("/llm/polish")
    public LlmPolishResponse polish(@RequestBody LlmPolishRequest req) {
        String polished = llmService.polish(req.content(), req.task_id());
        return new LlmPolishResponse(polished, false);
    }

    /** 已落档日志润色 */
    @PostMapping("/tasks/{taskId}/logs/{logId}/polish")
    public LlmPolishResponse polishLogged(@PathVariable Long taskId, @PathVariable Long logId) {
        List<Map<String, Object>> logs = workLogStore.listLogs(taskId, null, false, null, null);
        Map<String, Object> log = logs.stream()
                .filter(l -> l.get("id") != null && ((Number) l.get("id")).longValue() == logId)
                .findFirst()
                .orElseThrow(() -> new NotFoundException("日志不存在：" + logId));

        String content = (String) log.get("content");
        String polished = llmService.polish(content, taskId);
        return new LlmPolishResponse(polished, false);
    }

    // ============================================================
    // 总结
    // ============================================================

    /** 主体阶段总结 */
    @PostMapping("/tasks/{taskId}/summarize")
    public LlmSummarizeResponse summarizeMain(@PathVariable Long taskId) {
        String text = llmService.summarizeMain(taskId);
        return new LlmSummarizeResponse(text);
    }

    /** 维护期总结 */
    @PostMapping("/tasks/{taskId}/maintenance/summarize")
    public LlmSummarizeResponse summarizeMaintenance(@PathVariable Long taskId) {
        String text = llmService.summarizeMaintenance(taskId);
        return new LlmSummarizeResponse(text);
    }

    // ============================================================
    // 维护建议
    // ============================================================

    /** 询问是否进入维护期 */
    @PostMapping("/tasks/{taskId}/ask-maintenance")
    public LlmAskMaintenanceResponse askMaintenance(@PathVariable Long taskId) {
        String suggestion = llmService.askMaintenance(taskId);
        return new LlmAskMaintenanceResponse(suggestion);
    }

    // ============================================================
    // SSE 流式聊天
    // ============================================================

    /** 多轮对话（SSE） */
    @PostMapping(value = "/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter chatStream(@RequestBody ChatRequest req) {
        // 转换消息格式
        List<Map<String, String>> messages = req.messages().stream()
                .map(m -> Map.of("role", m.role(), "content", m.content()))
                .toList();
        return llmService.chatStream(messages);
    }
}