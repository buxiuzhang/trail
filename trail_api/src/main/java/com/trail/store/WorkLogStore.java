package com.trail.store;

import com.trail.db.SqliteDb;
import com.trail.store.exception.NotFoundException;
import com.trail.store.exception.StoreError;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

/** 工作日志（M8 SQLite 适配版）。is_deleted 改 0/1，log_date 是 TEXT。 */
@Component
public class WorkLogStore {

    public static final Set<String> PHASES = Set.of("main", "maintenance");
    private static final ObjectMapper JSON = new ObjectMapper();

    private final SqliteDb db;
    private final LogTodoRefStore logTodoRefStore;
    private final TaskStore taskStore;

    public WorkLogStore(SqliteDb db, LogTodoRefStore logTodoRefStore, TaskStore taskStore) {
        this.db = db;
        this.logTodoRefStore = logTodoRefStore;
        this.taskStore = taskStore;
    }

    public List<Map<String, Object>> listLogs(long taskId, String phase, boolean includeDeleted,
                                              Integer sinceDays, Integer limit) {
        return listLogs(taskId, phase, includeDeleted, sinceDays, limit, null, "desc");
    }

    public List<Map<String, Object>> listLogs(long taskId, String phase, boolean includeDeleted,
                                              Integer sinceDays, Integer limit, Integer offset) {
        return listLogs(taskId, phase, includeDeleted, sinceDays, limit, offset, "desc");
    }

    public List<Map<String, Object>> listLogs(long taskId, String phase, boolean includeDeleted,
                                              Integer sinceDays, Integer limit, Integer offset, String sort) {
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
        String dir = "asc".equalsIgnoreCase(sort) ? "ASC" : "DESC";
        StringBuilder sql = new StringBuilder("SELECT * FROM work_logs WHERE ")
                .append(where)
                .append(" ORDER BY log_date " + dir + ", ordinal " + dir);
        if (limit != null) {
            sql.append(" LIMIT ?");
            params.add(limit);
            if (offset != null && offset > 0) {
                sql.append(" OFFSET ?");
                params.add(offset);
            }
        }
        return db.query(sql.toString(), params.toArray());
    }

    public long countLogs(long taskId, String phase, boolean includeDeleted) {
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
        List<Map<String, Object>> rows = db.query(
            "SELECT COUNT(*) AS n FROM work_logs WHERE " + where, params.toArray());
        return ((Number) rows.get(0).get("n")).longValue();
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

    public Map<String, Object> addLog(long taskId, LocalDate logDate, String content, String phase, Double hours) {
        return addLog(taskId, logDate, content, phase, hours, null);
    }

    public Map<String, Object> addLog(long taskId, LocalDate logDate, String content, String phase, Double hours,
                                       List<Long> todoIds) {
        return addLog(taskId, logDate, content, phase, hours, todoIds, null);
    }

    public Map<String, Object> addLog(long taskId, LocalDate logDate, String content, String phase, Double hours,
                                       List<Long> todoIds, List<Long> taskIds) {
        if (content == null || content.isBlank()) throw new StoreError("日志内容不能为空");
        if (phase == null) phase = "main";
        if (!PHASES.contains(phase)) throw new StoreError("非法 phase：" + phase);
        if (hours == null) hours = 1.0;
        if (hours <= 0 || hours >= 12) throw new StoreError("工时必须大于 0 且小于 12");

        // 校验任务存在 + 封版规则
        List<Map<String, Object>> taskRows = db.query(
            "SELECT status, nature FROM tasks WHERE id = ?", taskId);
        if (taskRows.isEmpty()) throw new NotFoundException("任务不存在：" + taskId);
        Map<String, Object> taskRow = taskRows.get(0);
        if (TaskStore.isSealed(taskRow)) {
            String taskStatus = (String) taskRow.get("status");
            throw new StoreError("已作废".equals(taskStatus)
                ? "已作废的任务不能添加日志"
                : "已完成的任务不能添加日志（维护期除外）");
        }

        // ordinal = COALESCE(MAX(ordinal), -1) + 1
        List<Map<String, Object>> ordRows = db.query(
            "SELECT COALESCE(MAX(ordinal), -1) + 1 AS ord FROM work_logs"
          + " WHERE task_id = ? AND phase = ? AND log_date = ?",
            taskId, phase, logDate);
        int ordinal = ((Number) ordRows.get(0).get("ord")).intValue();

        Long newId = db.insertReturningId("""
            INSERT INTO work_logs
              (task_id, log_date, phase, ordinal, content, hours, task_ids, is_deleted, edit_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
            RETURNING id
            """,
            taskId, logDate, phase, ordinal, content.strip(), hours, toJsonArray(taskIds));
        if (newId == null) throw new StoreError("写日志失败");

        // 添加待办关联
        if (todoIds != null && !todoIds.isEmpty()) {
            logTodoRefStore.addRefs(newId, todoIds, taskId);
        }

        return getLog(newId);
    }

    public Map<String, Object> getLog(long logId) {
        List<Map<String, Object>> rows = db.query("SELECT * FROM work_logs WHERE id = ?", logId);
        if (rows.isEmpty()) throw new NotFoundException("日志不存在：" + logId);
        return rows.get(0);
    }

    /** 获取日志关联的待办 ID 列表 */
    public List<Long> getTodoIdsForLog(long logId) {
        return logTodoRefStore.getTodoIdsForLog(logId);
    }

    public Map<String, Object> updateLog(long logId, long taskId,
                                         String content, LocalDate logDate, String phase, Double hours) {
        return updateLog(logId, taskId, content, logDate, phase, hours, null);
    }

    public Map<String, Object> updateLog(long logId, long taskId,
                                         String content, LocalDate logDate, String phase, Double hours,
                                         List<Long> todoIds) {
        return updateLog(logId, taskId, content, logDate, phase, hours, todoIds, null);
    }

    public Map<String, Object> updateLog(long logId, long taskId,
                                         String content, LocalDate logDate, String phase, Double hours,
                                         List<Long> todoIds, List<Long> taskIds) {
        if (content == null && logDate == null && phase == null && hours == null && todoIds == null && taskIds == null)
            throw new StoreError("至少要改一个字段");
        if (content != null && content.isBlank()) throw new StoreError("日志内容不能为空");
        if (phase != null && !PHASES.contains(phase)) throw new StoreError("非法 phase：" + phase);
        if (hours != null && (hours <= 0 || hours >= 12)) throw new StoreError("工时必须大于 0 且小于 12");

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
        if (hours != null) {
            sets.append(", hours = ?");
            params.add(hours);
        }
        if (newOrdinal != oldOrdinal) {
            sets.append(", ordinal = ?");
            params.add(newOrdinal);
        }
        if (taskIds != null) {
            sets.append(", task_ids = ?");
            params.add(toJsonArray(taskIds));
        }
        if (!sets.toString().equals("updated_at = CURRENT_TIMESTAMP, edit_count = edit_count + 1")) {
            params.add(logId);
            db.update("UPDATE work_logs SET " + sets + " WHERE id = ?", params.toArray());
        }

        // 更新待办关联
        if (todoIds != null) {
            logTodoRefStore.replaceRefs(logId, todoIds, taskId);
        }

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

    // ============================================================
    // 日报/周报导出查询
    // ============================================================

    /** 查询指定日期的所有日志（关联任务信息） */
    public List<Map<String, Object>> getByDate(LocalDate date) {
        return db.query("""
            SELECT
                w.id, w.task_id, w.log_date, w.phase, w.ordinal, w.hours, w.task_ids, w.content, w.polished_content,
                t.title AS task_title, t.alias AS task_alias, t.status, t.nature
            FROM work_logs w
            JOIN tasks t ON t.id = w.task_id
            WHERE w.log_date = ? AND w.is_deleted = 0
            ORDER BY t.title, w.ordinal
            """, date);
    }

    /** 查询日期范围内的所有日志（关联任务信息） */
    public List<Map<String, Object>> getByDateRange(LocalDate start, LocalDate end) {
        return db.query("""
            SELECT
                w.id, w.task_id, w.log_date, w.phase, w.ordinal, w.hours, w.task_ids, w.content, w.polished_content,
                t.title AS task_title, t.alias AS task_alias, t.status, t.nature
            FROM work_logs w
            JOIN tasks t ON t.id = w.task_id
            WHERE w.log_date >= ? AND w.log_date <= ? AND w.is_deleted = 0
            ORDER BY w.log_date, t.title, w.ordinal
            """, start, end);
    }

    /**
     * 查询引用了指定待办的所有日志，经 enrichLogs 处理后返回。
     * 最新日期在前（由 LogTodoRefStore.getLogIdsForTodo 保证顺序）。
     */
    public List<Map<String, Object>> getLogsForTodo(long todoId) {
        List<Long> logIds = logTodoRefStore.getLogIdsForTodo(todoId);
        if (logIds.isEmpty()) return Collections.emptyList();

        String placeholders = logIds.stream().map(id -> "?").collect(Collectors.joining(","));
        List<Map<String, Object>> rows = db.query(
            "SELECT w.id, w.task_id, w.log_date, w.phase, w.ordinal, w.hours, w.task_ids, w.content," +
            " t.title AS task_title" +
            " FROM work_logs w JOIN tasks t ON t.id = w.task_id" +
            " WHERE w.id IN (" + placeholders + ") AND w.is_deleted = 0",
            logIds.toArray());

        // 按 logIds 顺序（log_date DESC）重排，IN 查询不保证顺序
        Map<Long, Map<String, Object>> byId = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            byId.put(((Number) row.get("id")).longValue(), row);
        }
        List<Map<String, Object>> ordered = new ArrayList<>();
        for (Long id : logIds) {
            if (byId.containsKey(id)) ordered.add(byId.get(id));
        }

        return enrichLogs(ordered);
    }

    /**
     * 批量解析日志列表的 @todo/@task 引用，就地附加 related_todos / related_tasks 字段。
     * getByDate / getByDateRange 查出来的日志调此方法后，LLM 可直接读到关联标题。
     */
    public List<Map<String, Object>> enrichLogs(List<Map<String, Object>> logs) {
        if (logs == null || logs.isEmpty()) return logs;

        // 批量查所有日志的关联待办，避免 N+1
        List<Long> logIds = logs.stream()
            .map(log -> ((Number) log.get("id")).longValue())
            .collect(Collectors.toList());
        Map<Long, List<Map<String, Object>>> todosByLogId = logTodoRefStore.getTodosForLogs(logIds);

        // 批量查所有日志引用的任务标题，避免 N+1
        Set<Long> allTaskIds = new java.util.LinkedHashSet<>();
        for (Map<String, Object> log : logs) {
            allTaskIds.addAll(parseTaskIds(log.getOrDefault("task_ids", "[]").toString()));
        }
        Map<Long, String> taskTitleMap = taskStore.getTaskTitles(new ArrayList<>(allTaskIds));

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> log : logs) {
            long logId = ((Number) log.get("id")).longValue();
            Map<String, Object> enriched = new LinkedHashMap<>(log);

            // 关联待办
            List<Map<String, Object>> todos = todosByLogId.getOrDefault(logId, List.of());
            if (!todos.isEmpty()) {
                enriched.put("related_todos", todos.stream()
                    .map(t -> Map.of(
                        "title", t.get("title"),
                        "done", Integer.valueOf(1).equals(t.get("is_completed"))
                    ))
                    .collect(Collectors.toList()));
            }

            // 关联任务
            List<Long> taskIds = parseTaskIds(log.getOrDefault("task_ids", "[]").toString());
            Map<Long, String> taskIdToTitle = new LinkedHashMap<>();
            if (!taskIds.isEmpty()) {
                List<String> taskTitles = new ArrayList<>();
                for (Long tid : taskIds) {
                    String title = taskTitleMap.get(tid);
                    if (title != null) {
                        taskIdToTitle.put(tid, title);
                        taskTitles.add(title);
                    }
                }
                if (!taskTitles.isEmpty()) {
                    enriched.put("related_tasks", taskTitles);
                }
            }

            // 替换 content 里的 @todo:id / @task:id 为真实标题
            Object contentObj = enriched.get("content");
            if (contentObj != null) {
                String content = contentObj.toString();
                for (Map<String, Object> todo : todos) {
                    long tid = ((Number) todo.get("id")).longValue();
                    String title = (String) todo.get("title");
                    content = content.replace("@todo:" + tid, "@todo「" + title + "」");
                }
                for (Map.Entry<Long, String> entry : taskIdToTitle.entrySet()) {
                    content = content.replace("@task:" + entry.getKey(), "@task「" + entry.getValue() + "」");
                }
                enriched.put("content", content);
            }

            result.add(enriched);
        }
        return result;
    }



    /** 将 task_ids 列表序列化为 JSON 字符串 */
    private String toJsonArray(List<Long> ids) {
        if (ids == null || ids.isEmpty()) return "[]";
        try {
            return JSON.writeValueAsString(ids);
        } catch (JsonProcessingException e) {
            return "[]";
        }
    }

    /** 从 JSON 字符串解析 task_ids 列表 */
    public List<Long> parseTaskIds(String json) {
        if (json == null || json.isBlank() || "[]".equals(json)) return Collections.emptyList();
        try {
            return JSON.readValue(json, new TypeReference<List<Long>>() {});
        } catch (JsonProcessingException e) {
            return Collections.emptyList();
        }
    }

    /** 获取日志关联的任务 ID 列表 */
    public List<Long> getTaskIdsForLog(long logId) {
        List<Map<String, Object>> rows = db.query("SELECT task_ids FROM work_logs WHERE id = ?", logId);
        if (rows.isEmpty()) return Collections.emptyList();
        Object v = rows.get(0).get("task_ids");
        if (v == null) return Collections.emptyList();
        return parseTaskIds(v.toString());
    }
}
