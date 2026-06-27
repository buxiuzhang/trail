package com.trail.vector;

import com.trail.db.SqliteDb;
import com.trail.service.EmbeddingService;
import com.trail.store.VectorStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

/**
 * 向量全量初始化（异步版）。
 * 调用 startAsync() 立即返回；前端通过 getStatus() 轮询进度。
 */
@Service
public class VectorInitService {

    private static final Logger log = LoggerFactory.getLogger(VectorInitService.class);

    // status 常量
    public static final String STATUS_IDLE    = "idle";
    public static final String STATUS_RUNNING = "running";
    public static final String STATUS_DONE    = "done";
    public static final String STATUS_FAILED  = "failed";

    private final SqliteDb db;
    private final EmbeddingService embeddingService;
    private final VectorStore vectorStore;
    private final Executor initExecutor;

    private final AtomicReference<InitJob> jobRef = new AtomicReference<>(InitJob.IDLE);

    public VectorInitService(SqliteDb db, EmbeddingService embeddingService,
                              VectorStore vectorStore,
                              @Qualifier("vectorInitExecutor") Executor initExecutor) {
        this.db = db;
        this.embeddingService = embeddingService;
        this.vectorStore = vectorStore;
        this.initExecutor = initExecutor;
    }

    // ── 公开 API ───────────────────────────────────────────────────

    /** 启动异步初始化。若已在运行，返回 already_running。 */
    public Map<String, Object> startAsync(boolean skipExisting) {
        InitJob current = jobRef.get();
        if (STATUS_RUNNING.equals(current.status())) {
            return Map.of("status", "already_running");
        }

        // 准备初始进度（total 此时为 0，稍后在任务里填）
        InitJob starting = InitJob.starting();
        jobRef.set(starting);

        initExecutor.execute(() -> runInit(skipExisting));
        return Map.of("status", "started");
    }

    /** 返回当前 job 状态（供前端轮询）。 */
    public Map<String, Object> getStatus() {
        return jobRef.get().toMap();
    }

    // ── 内部执行 ───────────────────────────────────────────────────

    private void runInit(boolean skipExisting) {
        long t0 = System.currentTimeMillis();
        try {
            Set<String> existingIds = skipExisting
                ? new HashSet<>(vectorStore.listIds())
                : Set.of();

            // 预查 total 数量，用于进度百分比
            int taskTotal = count("tasks");
            int logTotal  = count("work_logs WHERE is_deleted = 0");
            int todoTotal = count("todos");
            jobRef.set(InitJob.running(taskTotal, logTotal, todoTotal));

            // tasks
            int[] tasks = processEntities(
                db.query("SELECT id, title, description FROM tasks"),
                skipExisting, existingIds,
                row -> "task:" + row.get("id"),
                row -> {
                    String title = (String) row.get("title");
                    Object desc  = row.get("description");
                    return (desc instanceof String s && !s.isBlank()) ? title + "\n" + s : title;
                },
                "task",
                done -> updateProgress("tasks", done)
            );

            // logs
            int[] logs = processEntities(
                db.query("SELECT id, content, polished_content FROM work_logs WHERE is_deleted = 0"),
                skipExisting, existingIds,
                row -> "log:" + row.get("id"),
                row -> {
                    Object polished = row.get("polished_content");
                    String content  = (String) row.get("content");
                    return (polished instanceof String p && !p.isBlank()) ? p : content;
                },
                "log",
                done -> updateProgress("logs", done)
            );

            // todos
            int[] todos = processEntities(
                db.query("SELECT id, title, description FROM todos"),
                skipExisting, existingIds,
                row -> "todo:" + row.get("id"),
                row -> {
                    String title = (String) row.get("title");
                    Object desc  = row.get("description");
                    return (desc instanceof String s && !s.isBlank()) ? title + "\n" + s : title;
                },
                "todo",
                done -> updateProgress("todos", done)
            );

            long durationMs = System.currentTimeMillis() - t0;
            log.info("向量初始化完成：tasks={}/{} logs={}/{} todos={}/{} duration={}ms",
                tasks[0], tasks[0] + tasks[1], logs[0], logs[0] + logs[1],
                todos[0], todos[0] + todos[1], durationMs);

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("tasks",       entityStat(tasks));
            result.put("logs",        entityStat(logs));
            result.put("todos",       entityStat(todos));
            result.put("duration_ms", durationMs);
            jobRef.set(InitJob.done(result));

        } catch (Exception e) {
            log.error("向量初始化异常", e);
            jobRef.set(InitJob.failed(e.getMessage()));
        }
    }

    private int count(String fromClause) {
        List<Map<String, Object>> rows = db.query("SELECT COUNT(*) AS n FROM " + fromClause);
        if (rows.isEmpty()) return 0;
        Object n = rows.get(0).get("n");
        return n == null ? 0 : ((Number) n).intValue();
    }

    private void updateProgress(String entity, int done) {
        InitJob job = jobRef.get();
        if (!STATUS_RUNNING.equals(job.status())) return;
        @SuppressWarnings("unchecked")
        Map<String, Object> prog = (Map<String, Object>) job.progress().get(entity);
        if (prog == null) return;
        prog.put("done", done);
        // jobRef 本身不换引用，progress map 是可变 map，直接更新足够
    }

    private int[] processEntities(
            List<Map<String, Object>> rows,
            boolean skipExisting,
            Set<String> existingIds,
            java.util.function.Function<Map<String, Object>, String> idFn,
            java.util.function.Function<Map<String, Object>, String> textFn,
            String source,
            Consumer<Integer> progressCallback) {

        int indexed = 0, skipped = 0, failed = 0;
        for (Map<String, Object> row : rows) {
            String id = idFn.apply(row);
            try {
                if (skipExisting && existingIds.contains(id)) {
                    skipped++;
                } else {
                    String text = textFn.apply(row);
                    if (text == null || text.isBlank()) {
                        skipped++;
                    } else {
                        float[] vector = embeddingService.embed(text);
                        vectorStore.upsert(id, source, text, vector);
                        indexed++;
                    }
                }
            } catch (Exception e) {
                failed++;
                log.warn("向量初始化跳过 id={}: {}", id, e.getMessage());
            }
            progressCallback.accept(indexed + skipped + failed);
        }
        return new int[]{ indexed, skipped, failed };
    }

    private static Map<String, Object> entityStat(int[] stat) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("total",   stat[0] + stat[1] + stat[2]);
        m.put("indexed", stat[0]);
        m.put("skipped", stat[1]);
        m.put("failed",  stat[2]);
        return m;
    }

    // ── Job 状态 record ────────────────────────────────────────────

    record InitJob(String status, Map<String, Object> progress,
                   Map<String, Object> result, String error) {

        static final InitJob IDLE = new InitJob(STATUS_IDLE, Map.of(), null, null);

        static InitJob starting() {
            return new InitJob(STATUS_RUNNING, buildProgress(0, 0, 0), null, null);
        }

        static InitJob running(int taskTotal, int logTotal, int todoTotal) {
            return new InitJob(STATUS_RUNNING, buildProgress(taskTotal, logTotal, todoTotal), null, null);
        }

        static InitJob done(Map<String, Object> result) {
            return new InitJob(STATUS_DONE, Map.of(), result, null);
        }

        static InitJob failed(String error) {
            return new InitJob(STATUS_FAILED, Map.of(), null, error);
        }

        private static Map<String, Object> buildProgress(int taskTotal, int logTotal, int todoTotal) {
            Map<String, Object> prog = new LinkedHashMap<>();
            prog.put("tasks", mutableStat(taskTotal));
            prog.put("logs",  mutableStat(logTotal));
            prog.put("todos", mutableStat(todoTotal));
            return prog;
        }

        private static Map<String, Object> mutableStat(int total) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("done",  0);
            m.put("total", total);
            return m;
        }

        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("status",   status);
            m.put("progress", progress);
            if (result != null) m.put("result", result);
            if (error  != null) m.put("error",  error);
            return m;
        }
    }
}
