package com.trail.web.ws;

import com.trail.store.LLMSettingsStore;
import com.trail.store.TaskStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.SchedulingConfigurer;
import org.springframework.scheduling.config.ScheduledTaskRegistrar;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ScheduledFuture;

/**
 * 特别关注预警定时扫描。
 * cron 表达式存于 llm_settings.watch_cron（默认工作日 9 点和 14 点）。
 * 保存设置后调用 reschedule() 立即重建定时任务，无需重启。
 */
@Component
@EnableScheduling
public class WatchAlertScheduler implements SchedulingConfigurer {

    private static final Logger log = LoggerFactory.getLogger(WatchAlertScheduler.class);
    static final String DEFAULT_CRON = "0 9,14 * * 1-5";

    private final TaskStore taskStore;
    private final LLMSettingsStore settingsStore;
    private final WatchAlertSseService sseService;

    private ScheduledTaskRegistrar registrar;
    private ScheduledFuture<?> currentTask;

    public WatchAlertScheduler(TaskStore taskStore, LLMSettingsStore settingsStore,
                               WatchAlertSseService sseService) {
        this.taskStore = taskStore;
        this.settingsStore = settingsStore;
        this.sseService = sseService;
    }

    @Override
    public void configureTasks(ScheduledTaskRegistrar taskRegistrar) {
        this.registrar = taskRegistrar;
        schedule(taskRegistrar);
    }

    private void schedule(ScheduledTaskRegistrar taskRegistrar) {
        String cron = getCron();
        TaskScheduler scheduler = taskRegistrar.getScheduler();
        if (scheduler == null) return;
        currentTask = scheduler.schedule(this::check,
            new CronTrigger(cron, TimeZone.getDefault()));
        log.info("WatchAlert scheduled: cron={}", cron);
    }

    /** 设置保存后调用，重建定时任务。 */
    public void reschedule() {
        if (currentTask != null) {
            currentTask.cancel(false);
            currentTask = null;
        }
        if (registrar != null && registrar.getScheduler() != null) {
            String cron = getCron();
            currentTask = registrar.getScheduler().schedule(this::check,
                new CronTrigger(cron, TimeZone.getDefault()));
            log.info("WatchAlert rescheduled: cron={}", cron);
        }
    }

    public void check() {
        int warnDays = parseInt(settingsStore.get("watch_idle_warn_days"), 14);
        List<Map<String, Object>> watched = taskStore.listWatched();
        log.info("WatchAlert check: clients={} watched={} warnDays={}", sseService.hasClients(), watched.size(), warnDays);
        if (!sseService.hasClients()) return;
        LocalDate today = LocalDate.now();

        for (Map<String, Object> task : watched) {
            long id = ((Number) task.get("id")).longValue();
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

            sseService.broadcast(buildAlert(id, title, idle));
            log.info("WatchAlert sent: task={} title={} idle={}d", id, title, idle);
        }
    }

    private String getCron() {
        String v = settingsStore.get("watch_cron");
        String cron = (v != null && !v.isBlank()) ? v.trim() : DEFAULT_CRON;
        return toSpringCron(cron);
    }

    /** Spring CronTrigger 需要 6 段（加秒），前端存 5 段标准 cron，这里补 "0 " 前缀。 */
    private static String toSpringCron(String cron) {
        if (cron == null) return "0 0 9 * * 1-5";
        String t = cron.trim();
        long fields = t.chars().filter(c -> c == ' ').count() + 1;
        return fields == 5 ? "0 " + t : t;
    }

    private String lastDate(Map<String, Object> task) {
        for (String col : new String[]{"last_log_date", "processing_date", "start_date"}) {
            Object v = task.get(col);
            if (v != null && !v.toString().isBlank()) return v.toString().substring(0, 10);
        }
        return null;
    }

    private String buildAlert(long taskId, String title, long idleDays) {
        String safeTitle = title.replace("\\", "\\\\").replace("\"", "\\\"");
        return String.format(
            "{\"type\":\"watch_alert\",\"taskId\":%d,\"title\":\"%s\",\"idleDays\":%d,\"taskPath\":\"/task/%d\"}",
            taskId, safeTitle, idleDays, taskId);
    }

    private static int parseInt(String v, int def) {
        if (v == null || v.isBlank()) return def;
        try { return Integer.parseInt(v.trim()); } catch (NumberFormatException e) { return def; }
    }
}
