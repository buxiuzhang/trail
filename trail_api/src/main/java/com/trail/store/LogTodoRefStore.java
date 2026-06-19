package com.trail.store;

import com.trail.db.SqliteDb;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 日志-待办关联（M12：日志关联待办）。
 *
 * 多对多关系：一条日志可关联多个待办，一个待办可被多条日志引用。
 * 关联记录在 log_todo_refs 表。
 */
@Component
public class LogTodoRefStore {

    private final SqliteDb db;

    public LogTodoRefStore(SqliteDb db) {
        this.db = db;
    }

    /**
     * 批量添加关联。
     * 验证：待办必须属于同一个任务，且不能是已完成/已废弃状态。
     */
    public void addRefs(long logId, List<Long> todoIds, long taskId) {
        if (todoIds == null || todoIds.isEmpty()) return;

        for (Long todoId : todoIds) {
            // 验证待办存在且属于同一任务
            List<Map<String, Object>> rows = db.query(
                "SELECT task_id, is_completed, is_abandoned FROM todos WHERE id = ?", todoId);
            if (rows.isEmpty()) continue;  // 忽略不存在的待办
            Map<String, Object> row = rows.get(0);
            long todoTaskId = ((Number) row.get("task_id")).longValue();
            if (todoTaskId != taskId) continue;  // 忽略不属于同一任务的待办

            // 插入关联（忽略重复）
            db.update("""
                INSERT OR IGNORE INTO log_todo_refs (log_id, todo_id)
                VALUES (?, ?)
                """, logId, todoId);
        }
    }

    /**
     * 替换日志的所有关联（编辑场景）。
     * 先删除旧的关联，再添加新的。
     */
    public void replaceRefs(long logId, List<Long> todoIds, long taskId) {
        removeAllRefs(logId);
        if (todoIds != null && !todoIds.isEmpty()) {
            addRefs(logId, todoIds, taskId);
        }
    }

    /**
     * 删除日志的所有关联。
     */
    public void removeAllRefs(long logId) {
        db.update("DELETE FROM log_todo_refs WHERE log_id = ?", logId);
    }

    /**
     * 获取日志关联的待办 ID 列表。
     */
    public List<Long> getTodoIdsForLog(long logId) {
        List<Map<String, Object>> rows = db.query(
            "SELECT todo_id FROM log_todo_refs WHERE log_id = ? ORDER BY id", logId);
        List<Long> ids = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            ids.add(((Number) row.get("todo_id")).longValue());
        }
        return ids;
    }

    /**
     * 批量获取多条日志关联的待办详情，避免 N+1。
     * 返回 Map<logId, List<{id, title, is_completed, is_abandoned}>>
     */
    public Map<Long, List<Map<String, Object>>> getTodosForLogs(List<Long> logIds) {
        if (logIds == null || logIds.isEmpty()) return java.util.Collections.emptyMap();

        String placeholders = logIds.stream().map(id -> "?").collect(java.util.stream.Collectors.joining(","));
        List<Map<String, Object>> rows = db.query(
            "SELECT r.log_id, t.id, t.title, t.is_completed, t.is_abandoned" +
            " FROM log_todo_refs r" +
            " JOIN todos t ON t.id = r.todo_id" +
            " WHERE r.log_id IN (" + placeholders + ")" +
            " ORDER BY r.log_id, r.id",
            logIds.toArray());

        Map<Long, List<Map<String, Object>>> result = new java.util.LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            long logId = ((Number) row.get("log_id")).longValue();
            result.computeIfAbsent(logId, k -> new ArrayList<>())
                  .add(Map.of(
                      "id", row.get("id"),
                      "title", row.get("title"),
                      "is_completed", row.get("is_completed"),
                      "is_abandoned", row.get("is_abandoned")
                  ));
        }
        return result;
    }

    /**
     * 批量获取多条日志关联的待办 ID 列表，避免 N+1。
     * 返回 Map<logId, List<todoId>>
     */
    public Map<Long, List<Long>> getTodoIdsForLogs(List<Long> logIds) {
        if (logIds == null || logIds.isEmpty()) return java.util.Collections.emptyMap();

        String placeholders = logIds.stream().map(id -> "?").collect(java.util.stream.Collectors.joining(","));
        List<Map<String, Object>> rows = db.query(
            "SELECT log_id, todo_id FROM log_todo_refs" +
            " WHERE log_id IN (" + placeholders + ") ORDER BY log_id, id",
            logIds.toArray());

        Map<Long, List<Long>> result = new java.util.LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            long logId = ((Number) row.get("log_id")).longValue();
            long todoId = ((Number) row.get("todo_id")).longValue();
            result.computeIfAbsent(logId, k -> new ArrayList<>()).add(todoId);
        }
        return result;
    }

    /**
     * 获取日志关联的待办详情（含标题、状态等）。
     * 用于日志展示时显示关联待办。
     */
    public List<Map<String, Object>> getTodosForLog(long logId) {
        return db.query("""
            SELECT t.id, t.title, t.is_completed, t.is_abandoned
            FROM log_todo_refs r
            JOIN todos t ON t.id = r.todo_id
            WHERE r.log_id = ?
            ORDER BY r.id
            """, logId);
    }

    /**
     * 反向查询：获取引用了指定待办的所有日志 ID，最新日期在前。
     * 过滤软删除的日志（is_deleted = 0）。
     */
    public List<Long> getLogIdsForTodo(long todoId) {
        List<Map<String, Object>> rows = db.query(
            "SELECT r.log_id FROM log_todo_refs r" +
            " JOIN work_logs w ON w.id = r.log_id" +
            " WHERE r.todo_id = ? AND w.is_deleted = 0" +
            " ORDER BY w.log_date DESC, w.ordinal DESC",
            todoId);
        List<Long> ids = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            ids.add(((Number) row.get("log_id")).longValue());
        }
        return ids;
    }
}
