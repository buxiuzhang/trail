package com.trail.web.ws;

import com.trail.store.LLMSettingsStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.SchedulingConfigurer;
import org.springframework.scheduling.config.ScheduledTaskRegistrar;
import org.springframework.scheduling.support.CronTrigger;

import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ScheduledFuture;

/**
 * 通用告警调度基类，封装动态 cron 重调度逻辑。
 * 子类实现 check()、getCronKey()、getDefaultCron() 即可复用全套调度机制。
 */
@EnableScheduling
public abstract class AbstractAlertScheduler implements SchedulingConfigurer {

    protected final Logger log = LoggerFactory.getLogger(getClass());

    protected final LLMSettingsStore settingsStore;
    protected final WatchAlertSseService sseService;

    private ScheduledTaskRegistrar registrar;
    private ScheduledFuture<?> currentTask;

    protected AbstractAlertScheduler(LLMSettingsStore settingsStore, WatchAlertSseService sseService) {
        this.settingsStore = settingsStore;
        this.sseService = sseService;
    }

    protected abstract String getCronKey();
    protected abstract String getDefaultCron();
    public abstract void check();

    @Override
    public void configureTasks(ScheduledTaskRegistrar taskRegistrar) {
        this.registrar = taskRegistrar;
        schedule(taskRegistrar);
    }

    private void schedule(ScheduledTaskRegistrar taskRegistrar) {
        String cron = getCron();
        TaskScheduler scheduler = taskRegistrar.getScheduler();
        if (scheduler == null) return;
        currentTask = scheduler.schedule(this::check, new CronTrigger(cron, TimeZone.getDefault()));
        log.info("{} scheduled: cron={}", getClass().getSimpleName(), cron);
    }

    public void reschedule() {
        if (currentTask != null) {
            currentTask.cancel(false);
            currentTask = null;
        }
        if (registrar != null && registrar.getScheduler() != null) {
            String cron = getCron();
            currentTask = registrar.getScheduler().schedule(this::check,
                new CronTrigger(cron, TimeZone.getDefault()));
            log.info("{} rescheduled: cron={}", getClass().getSimpleName(), cron);
        }
    }

    protected String getCron() {
        String v = settingsStore.get(getCronKey());
        String cron = (v != null && !v.isBlank()) ? v.trim() : getDefaultCron();
        return toSpringCron(cron);
    }

    protected static String toSpringCron(String cron) {
        if (cron == null) return "0 0 9 * * 1-5";
        String t = cron.trim();
        long fields = t.chars().filter(c -> c == ' ').count() + 1;
        return fields == 5 ? "0 " + t : t;
    }

    protected static int parseInt(String v, int def) {
        if (v == null || v.isBlank()) return def;
        try { return Integer.parseInt(v.trim()); } catch (NumberFormatException e) { return def; }
    }

    /** 渲染消息模板，将 ${key} 替换为对应值；模板为空时使用 fallback。 */
    protected String renderTemplate(String template, String fallback, Map<String, String> vars) {
        String tpl = (template != null && !template.isBlank()) ? template : fallback;
        for (Map.Entry<String, String> e : vars.entrySet()) {
            tpl = tpl.replace("${" + e.getKey() + "}", e.getValue());
        }
        return tpl;
    }

    /** 构造 SSE payload JSON，包含渲染后的 message 字段。 */
    protected String buildPayload(String type, long taskId, String title, long idleDays,
                                  String taskPath, String message) {
        return "{" +
            "\"type\":\"" + esc(type) + "\"," +
            "\"taskId\":" + taskId + "," +
            "\"title\":\"" + esc(title) + "\"," +
            "\"idleDays\":" + idleDays + "," +
            "\"taskPath\":\"" + esc(taskPath) + "\"," +
            "\"message\":\"" + esc(message) + "\"" +
            "}";
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}
