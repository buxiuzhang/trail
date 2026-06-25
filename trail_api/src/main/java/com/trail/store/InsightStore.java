package com.trail.store;

import com.trail.db.SqliteDb;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 总览 + 停滞任务查询。 */
@Component
public class InsightStore {

    private final SqliteDb db;

    public InsightStore(SqliteDb db) {
        this.db = db;
    }

    public Map<String, Object> todayTodoStats() {
        String today = LocalDate.now().toString();
        List<Map<String, Object>> newRows = db.query("""
            SELECT COUNT(*) AS new_today
            FROM todos
            WHERE is_completed = 0 AND is_abandoned = 0
              AND date(created_at, 'localtime') = ?
            """, today);
        List<Map<String, Object>> followRows = db.query("""
            SELECT COUNT(DISTINCT er.ref_id) AS followed_today
            FROM entity_refs er
            JOIN work_logs wl ON wl.id = er.src_id
            WHERE er.src_type = 'log'
              AND er.ref_type = 'todo'
              AND wl.log_date = ?
              AND wl.is_deleted = 0
            """, today);
        Map<String, Object> result = new HashMap<>();
        result.put("new_today",      newRows.isEmpty()    ? 0 : newRows.get(0).getOrDefault("new_today", 0));
        result.put("followed_today", followRows.isEmpty() ? 0 : followRows.get(0).getOrDefault("followed_today", 0));
        return result;
    }

    public List<Map<String, Object>> staleTasks(int idleDays) {
        return db.query(
            "SELECT * FROM v_stale_tasks WHERE days_idle IS NULL OR days_idle >= ? ORDER BY days_idle DESC",
            idleDays);
    }

    /**
     * 任务健康评分。
     *
     * 维度与权重：
     *   activity  50% — days_idle（空 = 从未记录）
     *   todo      30% — 活跃待办完成率；无待办时按中性 70 分处理
     *   momentum  20% — 近 7 天工时占近 30 天工时比例
     *
     * 附加信号（不计入总分，供 LLM/前端展示）：
     *   log_days_30d    — 近 30 天有日报的自然天数
     *   overdue_todos   — 创建超过阈值天数仍未完成的待办数
     *   has_summary     — 是否填写了阶段总结
     *   watched         — 是否在特别关注列表
     */
    public List<Map<String, Object>> healthScores() {
        String date30 = LocalDate.now().minusDays(29).toString();
        String date7  = LocalDate.now().minusDays(6).toString();
        String today  = LocalDate.now().toString();
        int overdueDays = 14;
        String overdueDate = LocalDate.now().minusDays(overdueDays).toString();

        List<Map<String, Object>> rows = db.query("""
            SELECT
                t.id,
                t.title,
                t.status,
                t.nature,
                t.summary,
                t.watched_at,
                t.start_date,
                -- activity: days since last log (NULL = never logged)
                CAST(
                    julianday(date('now','localtime'))
                    - julianday((SELECT MAX(w.log_date) FROM work_logs w WHERE w.task_id = t.id AND w.is_deleted = 0))
                AS INTEGER) AS days_idle,
                (SELECT MAX(w.log_date) FROM work_logs w WHERE w.task_id = t.id AND w.is_deleted = 0) AS last_log_date,
                -- log coverage: distinct days with logs in last 30 days
                (SELECT COUNT(DISTINCT w.log_date)
                 FROM work_logs w
                 WHERE w.task_id = t.id AND w.is_deleted = 0
                   AND w.log_date >= ? AND w.log_date <= ?) AS log_days_30d,
                -- hours in last 30 days
                COALESCE((SELECT SUM(w.hours) FROM work_logs w
                          WHERE w.task_id = t.id AND w.is_deleted = 0
                            AND w.log_date >= ? AND w.log_date <= ?), 0.0) AS hours_30d,
                -- hours in last 7 days
                COALESCE((SELECT SUM(w.hours) FROM work_logs w
                          WHERE w.task_id = t.id AND w.is_deleted = 0
                            AND w.log_date >= ? AND w.log_date <= ?), 0.0) AS hours_7d,
                -- todo stats
                COALESCE((SELECT COUNT(*) FROM todos td
                          WHERE td.task_id = t.id AND td.is_completed = 0 AND td.is_abandoned = 0), 0) AS todo_active,
                COALESCE((SELECT COUNT(*) FROM todos td
                          WHERE td.task_id = t.id AND td.is_completed = 1), 0) AS todo_completed,
                COALESCE((SELECT COUNT(*) FROM todos td
                          WHERE td.task_id = t.id AND td.is_abandoned = 1), 0) AS todo_abandoned,
                -- overdue todos: active todos older than threshold
                COALESCE((SELECT COUNT(*) FROM todos td
                          WHERE td.task_id = t.id AND td.is_completed = 0 AND td.is_abandoned = 0
                            AND date(td.created_at, 'localtime') <= ?), 0) AS overdue_todos
            FROM tasks t
            WHERE t.status NOT IN ('已完成', '已作废')
            ORDER BY t.id
            """,
            date30, today,
            date30, today,
            date7,  today,
            overdueDate
        );

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            // ── activity score (50%) ──────────────────────────────
            Object idleObj = r.get("days_idle");
            int actScore;
            if (idleObj == null) {
                actScore = 0; // never logged
            } else {
                int idle = ((Number) idleObj).intValue();
                if      (idle == 0) actScore = 100;
                else if (idle <= 3) actScore = 85;
                else if (idle <= 7) actScore = 60;
                else if (idle <= 14) actScore = 35;
                else                actScore = 10;
            }

            // ── todo score (30%) ─────────────────────────────────
            int active    = ((Number) r.get("todo_active")).intValue();
            int completed = ((Number) r.get("todo_completed")).intValue();
            int abandoned = ((Number) r.get("todo_abandoned")).intValue();
            int total     = active + completed + abandoned;
            int todoScore;
            if (total == 0) {
                todoScore = 70; // neutral: no todos
            } else {
                double rate = (double) completed / total;
                todoScore = (int) Math.round(rate * 100);
                // penalty for active overdue todos
                int overdue = ((Number) r.get("overdue_todos")).intValue();
                todoScore = Math.max(0, todoScore - overdue * 10);
            }

            // ── momentum score (20%) ─────────────────────────────
            double h30 = ((Number) r.get("hours_30d")).doubleValue();
            double h7  = ((Number) r.get("hours_7d")).doubleValue();
            int momentumScore;
            if (h30 == 0) {
                momentumScore = 0;
            } else {
                // ideal: 7-day hours ≈ 7/30 of monthly hours (proportional)
                double expected7 = h30 * 7.0 / 30.0;
                double ratio = h7 / expected7;
                if      (ratio >= 1.2) momentumScore = 100;
                else if (ratio >= 0.8) momentumScore = 80;
                else if (ratio >= 0.4) momentumScore = 50;
                else                  momentumScore = 20;
            }

            int score = (int) Math.round(actScore * 0.5 + todoScore * 0.3 + momentumScore * 0.2);

            String grade;
            if      (score >= 85) grade = "优";
            else if (score >= 70) grade = "良";
            else if (score >= 50) grade = "中";
            else                  grade = "差";

            Map<String, Object> dimensions = new LinkedHashMap<>();
            Map<String, Object> actDim = new LinkedHashMap<>();
            actDim.put("score", actScore);
            actDim.put("days_idle", idleObj);
            actDim.put("log_days_30d", r.get("log_days_30d"));
            dimensions.put("activity", actDim);

            Map<String, Object> todoDim = new LinkedHashMap<>();
            todoDim.put("score", todoScore);
            todoDim.put("total", total);
            todoDim.put("completed", completed);
            todoDim.put("active", active);
            todoDim.put("abandoned", abandoned);
            todoDim.put("overdue", r.get("overdue_todos"));
            todoDim.put("completion_rate", total == 0 ? null : Math.round((double) completed / total * 100) / 100.0);
            dimensions.put("todo", todoDim);

            Map<String, Object> momDim = new LinkedHashMap<>();
            momDim.put("score", momentumScore);
            momDim.put("hours_7d", Math.round(h7 * 10) / 10.0);
            momDim.put("hours_30d", Math.round(h30 * 10) / 10.0);
            dimensions.put("momentum", momDim);

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("task_id",       r.get("id"));
            item.put("title",         r.get("title"));
            item.put("status",        r.get("status"));
            item.put("nature",        r.get("nature"));
            item.put("score",         score);
            item.put("grade",         grade);
            item.put("dimensions",    dimensions);
            item.put("last_log_date", r.get("last_log_date"));
            item.put("has_summary",   r.get("summary") != null && !r.get("summary").toString().isBlank());
            item.put("watched",       r.get("watched_at") != null);
            result.add(item);
        }

        result.sort((a, b) -> Integer.compare(
            ((Number) a.get("score")).intValue(),
            ((Number) b.get("score")).intValue()
        ));
        return result;
    }

    public Map<String, Object> overview() {
        List<Map<String, Object>> taskRows = db.query("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status");
        List<Map<String, Object>> natureRows = db.query("SELECT nature, COUNT(*) AS n FROM tasks GROUP BY nature");
        List<Map<String, Object>> logCountRow = db.query("SELECT COUNT(*) AS n FROM work_logs WHERE is_deleted = 0");
        List<Map<String, Object>> taskCountRow = db.query("SELECT COUNT(*) AS n FROM tasks");
        List<Map<String, Object>> tagRows = db.query("SELECT tags FROM tasks");
        List<Map<String, Object>> monthRows = db.query(
            "SELECT strftime('%Y-%m', COALESCE(processing_date, start_date)) AS m, COUNT(*) AS n" +
            " FROM tasks WHERE COALESCE(processing_date, start_date) IS NOT NULL GROUP BY m ORDER BY m DESC");

        Map<String, Integer> byStatus = new HashMap<>();
        for (String s : TaskStore.TASK_STATUSES) byStatus.put(s, 0);
        for (Map<String, Object> r : taskRows) {
            byStatus.put((String) r.get("status"), ((Number) r.get("n")).intValue());
        }

        Map<String, Integer> byNature = new HashMap<>();
        for (String n : TaskStore.TASK_NATURES) byNature.put(n, 0);
        for (Map<String, Object> r : natureRows) {
            byNature.put((String) r.get("nature"), ((Number) r.get("n")).intValue());
        }

        // 展开 tags JSON 数组统计
        Map<String, Integer> byTag = new HashMap<>();
        for (Map<String, Object> r : tagRows) {
            String tagsJson = r.get("tags") != null ? r.get("tags").toString().trim() : "[]";
            if (tagsJson.equals("[]") || tagsJson.isEmpty()) continue;
            String inner = tagsJson.substring(1, tagsJson.length() - 1);
            for (String part : inner.split(",")) {
                String tag = part.trim().replaceAll("^\"|\"$", "");
                if (!tag.isEmpty()) byTag.merge(tag, 1, Integer::sum);
            }
        }

        Map<String, Integer> byMonth = new HashMap<>();
        for (Map<String, Object> r : monthRows) {
            String m = (String) r.get("m");
            if (m != null) byMonth.put(m, ((Number) r.get("n")).intValue());
        }

        Map<String, Object> out = new HashMap<>();
        out.put("total_tasks", ((Number) taskCountRow.get(0).get("n")).intValue());
        out.put("by_status", byStatus);
        out.put("by_nature", byNature);
        out.put("by_tag", byTag);
        out.put("by_month", byMonth);
        out.put("total_logs", ((Number) logCountRow.get(0).get("n")).intValue());

        List<Map<String, Object>> todoStats = db.query(
            "SELECT" +
            "  COUNT(CASE WHEN is_completed=0 AND is_abandoned=0 THEN 1 END) AS active," +
            "  COUNT(CASE WHEN is_completed=1 THEN 1 END) AS completed" +
            " FROM todos");
        if (!todoStats.isEmpty()) {
            out.put("todo_active_count",    ((Number) todoStats.get(0).getOrDefault("active",    0)).intValue());
            out.put("todo_completed_count", ((Number) todoStats.get(0).getOrDefault("completed", 0)).intValue());
        }
        return out;
    }
}
