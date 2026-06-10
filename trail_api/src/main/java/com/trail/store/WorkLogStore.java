package com.trail.store;

import com.trail.db.SqliteDb;
import com.trail.store.exception.NotFoundException;
import com.trail.store.exception.StoreError;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 工作日志（M8 SQLite 适配版）。is_deleted 改 0/1，log_date 是 TEXT。 */
@Component
public class WorkLogStore {

    public static final Set<String> PHASES = Set.of("main", "maintenance");

    private final SqliteDb db;

    public WorkLogStore(SqliteDb db) {
        this.db = db;
    }

    public List<Map<String, Object>> listLogs(long taskId, String phase, boolean includeDeleted,
                                              Integer sinceDays, Integer limit) {
        StringBuilder where = new StringBuilder("task_id = ?");
        List<Object> params = new ArrayList<>();
        params.add(taskId);
        if (phase != null && !phase.isBlank()) {
            where.append(" AND phase = ?");
            params.add(phase);
        }
        if (!includeDeleted) {
            where.append(" AND is_deleted = 0");
        }
        if (sinceDays != null) {
            LocalDate cutoff = LocalDate.now().minusDays(sinceDays);
            where.append(" AND log_date >= ?");
            params.add(cutoff);
        }
        StringBuilder sql = new StringBuilder("SELECT * FROM work_logs WHERE ")
                .append(where)
                .append(" ORDER BY log_date, ordinal");
        if (limit != null) {
            sql.append(" LIMIT ?");
            params.add(limit);
        }
        return db.query(sql.toString(), params.toArray());
    }

    public LocalDate latestLogDate(long taskId) {
        List<Map<String, Object>> rows = db.query(
            "SELECT MAX(log_date) AS d FROM work_logs WHERE task_id = ? AND is_deleted = 0",
            taskId);
        if (rows.isEmpty()) return null;
        Object d = rows.get(0).get("d");
        if (d == null) return null;
        // SQLite 给 String（DATE 文本）
        if (d instanceof String s) return parseLocalDate(s);
        if (d instanceof LocalDate ld) return ld;
        return parseLocalDate(d.toString());
    }

    private static LocalDate parseLocalDate(String s) {
        try { return LocalDate.parse(s); }
        catch (DateTimeParseException ignored) {}
        try { return LocalDate.parse(s.length() >= 10 ? s.substring(0, 10) : s); }
        catch (DateTimeParseException ignored) {}
        return null;
    }

    public Map<String, Object> addLog(long taskId, LocalDate logDate, String content, String phase) {
        if (content == null || content.isBlank()) throw new StoreError("日志内容不能为空");
        if (phase == null) phase = "main";
        if (!PHASES.contains(phase)) throw new StoreError("非法 phase：" + phase);

        // 校验任务存在 + 封版规则
        List<Map<String, Object>> taskRows = db.query(
            "SELECT status, nature FROM tasks WHERE id = ?", taskId);
        if (taskRows.isEmpty()) throw new NotFoundException("任务不存在：" + taskId);
        String taskStatus = (String) taskRows.get(0).get("status");
        String taskNature = (String) taskRows.get(0).get("nature");
        if ("已作废".equals(taskStatus)) throw new StoreError("已作废的任务不能添加日志");
        if ("已完成".equals(taskStatus) && !"维护".equals(taskNature))
            throw new StoreError("已完成的任务不能添加日志（维护期除外）");

        // ordinal = COALESCE(MAX(ordinal), -1) + 1
        List<Map<String, Object>> ordRows = db.query(
            "SELECT COALESCE(MAX(ordinal), -1) + 1 AS ord FROM work_logs"
          + " WHERE task_id = ? AND phase = ? AND log_date = ?",
            taskId, phase, logDate);
        int ordinal = ((Number) ordRows.get(0).get("ord")).intValue();

        Long newId = db.insertReturningId("""
            INSERT INTO work_logs
              (task_id, log_date, phase, ordinal, content, is_deleted, edit_count)
            VALUES (?, ?, ?, ?, ?, 0, 0)
            RETURNING id
            """,
            taskId, logDate, phase, ordinal, content.strip());
        if (newId == null) throw new StoreError("写日志失败");
        return getLog(newId);
    }

    public Map<String, Object> getLog(long logId) {
        List<Map<String, Object>> rows = db.query("SELECT * FROM work_logs WHERE id = ?", logId);
        if (rows.isEmpty()) throw new NotFoundException("日志不存在：" + logId);
        return rows.get(0);
    }

    public Map<String, Object> updateLog(long logId, long taskId,
                                         String content, LocalDate logDate, String phase) {
        if (content == null && logDate == null && phase == null)
            throw new StoreError("至少要改一个字段");
        if (content != null && content.isBlank()) throw new StoreError("日志内容不能为空");
        if (phase != null && !PHASES.contains(phase)) throw new StoreError("非法 phase：" + phase);

        // 查旧值
        List<Map<String, Object>> oldRows = db.query(
            "SELECT log_date, phase, ordinal FROM work_logs"
          + " WHERE id = ? AND task_id = ? AND is_deleted = 0",
            logId, taskId);
        if (oldRows.isEmpty())
            throw new NotFoundException("日志不存在或不属于此任务：log=" + logId + " task=" + taskId);
        Map<String, Object> old = oldRows.get(0);
        Object logDateRaw = old.get("log_date");
        LocalDate oldDate = logDateRaw instanceof LocalDate ld
                ? ld
                : parseLocalDate(logDateRaw.toString());
        String oldPhase = (String) old.get("phase");
        int oldOrdinal = ((Number) old.get("ordinal")).intValue();

        LocalDate newDate = logDate != null ? logDate : oldDate;
        String newPhase = phase != null ? phase : oldPhase;
        int newOrdinal = oldOrdinal;
        if (!newDate.equals(oldDate) || !newPhase.equals(oldPhase)) {
            List<Map<String, Object>> maxRows = db.query(
                "SELECT COALESCE(MAX(ordinal), -1) + 1 AS ord FROM work_logs"
              + " WHERE task_id = ? AND phase = ? AND log_date = ? AND id != ? AND is_deleted = 0",
                taskId, newPhase, newDate, logId);
            newOrdinal = ((Number) maxRows.get(0).get("ord")).intValue();
        }

        StringBuilder sets = new StringBuilder("updated_at = CURRENT_TIMESTAMP, edit_count = edit_count + 1");
        List<Object> params = new ArrayList<>();
        if (content != null) {
            sets.append(", content = ?");
            params.add(content.strip());
        }
        if (logDate != null) {
            sets.append(", log_date = ?");
            params.add(newDate);
        }
        if (phase != null) {
            sets.append(", phase = ?");
            params.add(newPhase);
        }
        if (newOrdinal != oldOrdinal) {
            sets.append(", ordinal = ?");
            params.add(newOrdinal);
        }
        params.add(logId);
        db.update("UPDATE work_logs SET " + sets + " WHERE id = ?", params.toArray());
        return getLog(logId);
    }

    public void deleteLog(long logId, long taskId, boolean hard) {
        if (hard) {
            int n = db.update(
                "DELETE FROM work_logs WHERE id = ? AND task_id = ? RETURNING id",
                logId, taskId);
            if (n == 0) throw new NotFoundException("日志不存在或不属于此任务：log=" + logId + " task=" + taskId);
        } else {
            int n = db.update(
                "UPDATE work_logs SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP"
              + " WHERE id = ? AND task_id = ? AND is_deleted = 0 RETURNING id",
                logId, taskId);
            if (n == 0) throw new NotFoundException("日志不存在或不属于此任务：log=" + logId + " task=" + taskId);
        }
    }
}
