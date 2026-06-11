package com.trail.web.controller;

import com.trail.store.LLMSettingsStore;
import com.trail.web.dto.PlaceholderSettingsDto;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/** 占位提示语配置：任务描述 / 编年日志 / 补充说明 */
@RestController
@RequestMapping("/api/settings/placeholders")
public class PlaceholderSettingsController {

    private static final String DEFAULT_TASK_DESC = "把要做什么写清楚。先粗糙后润色。";
    private static final String DEFAULT_LOG = "今日所记……";
    private static final String DEFAULT_TODO_NOTE = "需要先申请测试 key、跨团队协调人 …";

    private static final String KEY_TASK_DESC = "placeholder_task_desc";
    private static final String KEY_LOG = "placeholder_log";
    private static final String KEY_TODO_NOTE = "placeholder_todo_note";

    private final LLMSettingsStore store;

    public PlaceholderSettingsController(LLMSettingsStore store) {
        this.store = store;
    }

    @GetMapping
    public PlaceholderSettingsDto get() {
        String taskDesc = store.get(KEY_TASK_DESC);
        String log = store.get(KEY_LOG);
        String todoNote = store.get(KEY_TODO_NOTE);

        return new PlaceholderSettingsDto(
            taskDesc == null || taskDesc.isBlank() ? DEFAULT_TASK_DESC : taskDesc,
            log == null || log.isBlank() ? DEFAULT_LOG : log,
            todoNote == null || todoNote.isBlank() ? DEFAULT_TODO_NOTE : todoNote
        );
    }

    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, String> body) {
        String taskDesc = body.get("task_desc");
        String log = body.get("log");
        String todoNote = body.get("todo_note");

        // 空 = 删除 = 回归默认值
        if (taskDesc == null || taskDesc.isBlank()) {
            store.delete(KEY_TASK_DESC);
            taskDesc = DEFAULT_TASK_DESC;
        } else {
            store.save(KEY_TASK_DESC, taskDesc);
        }

        if (log == null || log.isBlank()) {
            store.delete(KEY_LOG);
            log = DEFAULT_LOG;
        } else {
            store.save(KEY_LOG, log);
        }

        if (todoNote == null || todoNote.isBlank()) {
            store.delete(KEY_TODO_NOTE);
            todoNote = DEFAULT_TODO_NOTE;
        } else {
            store.save(KEY_TODO_NOTE, todoNote);
        }

        return Map.of("ok", true, "task_desc", taskDesc, "log", log, "todo_note", todoNote);
    }
}