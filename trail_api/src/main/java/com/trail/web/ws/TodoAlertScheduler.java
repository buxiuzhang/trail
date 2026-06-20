package com.trail.web.ws;

import com.trail.store.LLMSettingsStore;
import com.trail.store.TodoStore;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

/**
 * 待办事项超期预警定时扫描。
 * 扫描所有未完成、未废弃的待办，距创建日期超过阈值时通过 SSE 推送。
 * cron 存于 llm_settings.todo_cron（默认工作日 9、14 点）。
 */
@Component
public class TodoAlertScheduler extends AbstractAlertScheduler {

    static final String DEFAULT_CRON = "0 9,14 * * 1-5";

    private final TodoStore todoStore;

    public TodoAlertScheduler(TodoStore todoStore, LLMSettingsStore settingsStore,
                              WatchAlertSseService sseService) {
        super(settingsStore, sseService);
        this.todoStore = todoStore;
    }

    @Override protected String getCronKey()     { return "todo_cron"; }
    @Override protected String getDefaultCron() { return DEFAULT_CRON; }

    @Override
    public void check() {
        int warnDays = parseInt(settingsStore.get("todo_idle_warn_days"), 7);
        String template = settingsStore.get("todo_alert_template");
        List<Map<String, Object>> todos = todoStore.listIncompleteTodos();
        log.info("TodoAlert check: clients={} todos={} warnDays={}",
            sseService.hasClients(), todos.size(), warnDays);
        if (!sseService.hasClients()) return;

        LocalDate today = LocalDate.now();
        for (Map<String, Object> row : todos) {
            long todoId      = ((Number) row.get("todo_id")).longValue();
            long taskId      = ((Number) row.get("task_id")).longValue();
            String todoTitle = (String) row.get("todo_title");
            String taskTitle = (String) row.get("task_title");
            String createdAt = row.get("todo_created_at") != null
                ? row.get("todo_created_at").toString().substring(0, 10) : null;
            if (createdAt == null) continue;

            long idle;
            try { idle = ChronoUnit.DAYS.between(LocalDate.parse(createdAt), today); }
            catch (Exception e) { continue; }
            if (idle < warnDays) continue;

            String path = "/task/" + taskId;
            String fallback = "**" + taskTitle + "** 待办事项超期提醒：\n\n你有一条关于 **" + todoTitle
                + "** 的待办超期提醒：该待办已创建 **" + idle + " 天**，尚未完成，请关注进展。";
            java.util.Map<String, String> vars = java.util.Map.of(
                "task_title", taskTitle,
                "todo_title", todoTitle,
                "idle_days",  String.valueOf(idle)
            );
            String message = renderTemplate(template, fallback, vars)
                + "\n\n[查看任务](" + path + ")　　[今日忽略](action:ignore:" + todoId + ")";
            sseService.broadcast(buildPayload("todo_alert", todoId, taskTitle + " · " + todoTitle, idle, path, message));
            log.info("TodoAlert sent: todo={} task={} idle={}d", todoId, taskId, idle);
        }
    }
}
