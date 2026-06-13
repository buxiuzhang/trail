package com.trail.web.controller;

import com.trail.store.LLMSettingsStore;
import com.trail.web.dto.PlaceholderSettingsDto;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 占位提示语配置：任务描述 / 编年日志 / 补充说明
 *
 * 默认值在 application.yml 的 trail.defaults 配置，
 * 启动时由 DefaultSettingsInitializer 初始化到数据库。
 */
@RestController
@RequestMapping("/api/settings/placeholders")
public class PlaceholderSettingsController {

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
            taskDesc == null ? "" : taskDesc,
            log == null ? "" : log,
            todoNote == null ? "" : todoNote
        );
    }

    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, String> body) {
        String taskDesc = body.get("task_desc");
        String log = body.get("log");
        String todoNote = body.get("todo_note");

        // 空 = 删除
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