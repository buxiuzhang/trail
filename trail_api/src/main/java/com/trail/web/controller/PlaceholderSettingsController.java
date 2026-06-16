package com.trail.web.controller;

import com.trail.store.LLMSettingsStore;
import com.trail.web.dto.PlaceholderSettingsDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 占位提示语配置
 */
@RestController
@RequestMapping("/api/settings/placeholders")
@Tag(name = "占位提示语", description = "编辑器输入框的占位提示文本")
public class PlaceholderSettingsController {

    private static final String KEY_TASK_DESC = "placeholder_task_desc";
    private static final String KEY_LOG = "placeholder_log";
    private static final String KEY_TODO_NOTE = "placeholder_todo_note";

    private final LLMSettingsStore store;

    public PlaceholderSettingsController(LLMSettingsStore store) {
        this.store = store;
    }

    @Operation(summary = "获取占位提示语", description = "获取任务描述、编年日志、补充说明的占位提示")
    @GetMapping
    public PlaceholderSettingsDto get() {
        String taskDesc = store.get(KEY_TASK_DESC);
        String log = store.get(KEY_LOG);
        String todoNote = store.get(KEY_TODO_NOTE);

        return new PlaceholderSettingsDto(
            taskDesc == null ? "" : taskDesc,
            log == null ? "" : log,
            todoNote == null ? "" : todoNote
        );
    }

    @Operation(summary = "保存占位提示语", description = "设置各编辑器的占位提示文本")
    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, String> body) {
        String taskDesc = body.get("task_desc");
        String log = body.get("log");
        String todoNote = body.get("todo_note");

        if (taskDesc == null || taskDesc.isBlank()) {
            store.delete(KEY_TASK_DESC);
            taskDesc = "";
        } else {
            store.save(KEY_TASK_DESC, taskDesc);
        }

        if (log == null || log.isBlank()) {
            store.delete(KEY_LOG);
            log = "";
        } else {
            store.save(KEY_LOG, log);
        }

        if (todoNote == null || todoNote.isBlank()) {
            store.delete(KEY_TODO_NOTE);
            todoNote = "";
        } else {
            store.save(KEY_TODO_NOTE, todoNote);
        }

        return Map.of("ok", true, "task_desc", taskDesc, "log", log, "todo_note", todoNote);
    }
}
