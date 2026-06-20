package com.trail.web.ws;

import com.trail.store.LLMSettingsStore;
import com.trail.store.TaskStore;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

/**
 * 特别关注预警定时扫描。
 * cron 存于 llm_settings.watch_cron（默认工作日 9、14 点）。
 */
@Component
public class WatchAlertScheduler extends AbstractAlertScheduler {

    static final String DEFAULT_CRON = "0 9,14 * * 1-5";

    private final TaskStore taskStore;

    public WatchAlertScheduler(TaskStore taskStore, LLMSettingsStore settingsStore,
                               WatchAlertSseService sseService) {
        super(settingsStore, sseService);
        this.taskStore = taskStore;
    }

    @Override protected String getCronKey()     { return "watch_cron"; }
    @Override protected String getDefaultCron() { return DEFAULT_CRON; }

    @Override
    public void check() {
        int warnDays = parseInt(settingsStore.get("watch_idle_warn_days"), 14);
        String template = settingsStore.get("watch_alert_template");
        List<Map<String, Object>> watched = taskStore.listWatched();
        log.info("WatchAlert check: clients={} watched={} warnDays={}",
            sseService.hasClients(), watched.size(), warnDays);
        if (!sseService.hasClients()) return;

        LocalDate today = LocalDate.now();
        for (Map<String, Object> task : watched) {
            long id      = ((Number) task.get("id")).longValue();
            String title = (String) task.get("title");
            String lastDateStr = lastDate(task);
            long idle;
            if (lastDateStr == null) {
                String watchedAt = task.get("watched_at") != null
                    ? task.get("watched_at").toString().substring(0, 10) : null;
                if (watchedAt != null) {
                    try { idle = ChronoUnit.DAYS.between(LocalDate.parse(watchedAt), today); }
                    catch (Exception e) { idle = 0; }
                } else {
                    idle = warnDays;
                }
            } else {
                try { idle = ChronoUnit.DAYS.between(LocalDate.parse(lastDateStr), today); }
                catch (Exception e) { continue; }
            }
            if (idle < warnDays) continue;

            String path = "/task/" + id;
            String fallback = "**" + title + "** 特别关注预警：\n\n该任务已 **" + idle + " 天**未记录日志，请关注进展。";
            java.util.Map<String, String> vars = java.util.Map.of(
                "task_title", title,
                "idle_days",  String.valueOf(idle)
            );
            String message = renderTemplate(template, fallback, vars)
                + "\n\n[查看任务详情](" + path + ")　　[今日忽略](action:ignore:" + id + ")";
            sseService.broadcast(buildPayload("watch_alert", id, title, idle, path, message));
            log.info("WatchAlert sent: task={} idle={}d", id, idle);
        }
    }

    private String lastDate(Map<String, Object> task) {
        for (String col : new String[]{"last_log_date", "processing_date", "start_date"}) {
            Object v = task.get(col);
            if (v != null && !v.toString().isBlank()) return v.toString().substring(0, 10);
        }
        return null;
    }
}
