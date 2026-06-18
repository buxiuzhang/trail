package com.trail.store;

import com.trail.db.SqliteDb;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 总览 + 停滞任务查询。 */
@Component
public class InsightStore {

    private final SqliteDb db;

    public InsightStore(SqliteDb db) {
        this.db = db;
    }

    public List<Map<String, Object>> staleTasks(int idleDays) {
        return db.query(
            "SELECT * FROM v_stale_tasks WHERE days_idle IS NULL OR days_idle >= ? ORDER BY days_idle DESC",
            idleDays);
    }

    public List<Map<String, Object>> recentTasks(int days) {
        return db.query(
            """
            SELECT
                t.id, t.title, t.status, t.nature,
                MAX(w.log_date) AS last_log_date,
                COUNT(w.id) AS log_count
            FROM tasks t
            JOIN work_logs w ON w.task_id = t.id AND w.is_deleted = 0
            WHERE w.log_date >= date('now', '-' || ? || ' days')
              AND t.status = '进行中'
            GROUP BY t.id
            ORDER BY log_count DESC
            """,
            days);
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
        return out;
    }
}
