package com.trail.store;

import com.trail.db.SqliteDb;
import com.trail.store.exception.NotFoundException;
import com.trail.store.exception.StoreError;
import com.trail.vector.VectorIndexEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 任务待办（M9：详情页 header 下方区块）。
 *
 * 状态机单向：
 *   - 默认态：is_completed=0 AND is_abandoned=0（未完成）
 *   - 已完成：is_completed=1（终态，不可废弃）
 *   - 已废弃：is_abandoned=1（终态，不可恢复）
 *   - 互斥：completed 与 abandoned 同一时刻至多一个为真
 *
 * 排序（listTodos SQL 内固定）：未完成 → 已完成 → 已废弃；组内 created_at 升序。
 */
@Component
public class TodoStore {

    private final SqliteDb db;
    private final EntityRefStore entityRefStore;
    private final ApplicationEventPublisher publisher;

    public TodoStore(SqliteDb db, EntityRefStore entityRefStore, ApplicationEventPublisher publisher) {
        this.db = db;
        this.entityRefStore = entityRefStore;
        this.publisher = publisher;
    }

    private static String todoText(String title, String description) {
        return (description != null && !description.isBlank()) ? title + "\n" + description : title;
    }

    /**
     * 列出某任务的 todos，按"未完成浮顶 → 已完成 → 已废弃"组内 created_at 升序。
     */
    public List<Map<String, Object>> listTodos(long taskId) {
        return db.query("""
            SELECT * FROM todos
             WHERE task_id = ?
             ORDER BY
               CASE WHEN is_abandoned = 1 THEN 2
                    WHEN is_completed = 1 THEN 1
                    ELSE 0 END,
               created_at ASC
            """, taskId);
    }

    public Map<String, Object> getTodo(long todoId) {
        List<Map<String, Object>> rows = db.query("SELECT * FROM todos WHERE id = ?", todoId);
        if (rows.isEmpty()) throw new NotFoundException("待办不存在：" + todoId);
        return rows.get(0);
    }

    /**
     * 新增。任务不存在抛 404；已作废或已完成非维护任务抛 400（与 work_logs 同源规则）。
     */
    public Map<String, Object> addTodo(long taskId, String title, String description) {
        if (title == null || title.isBlank()) throw new StoreError("待办标题不能为空");
        String t = title.strip();
        String d = (description == null || description.isBlank()) ? null : description.strip();

        List<Map<String, Object>> taskRows = db.query(
            "SELECT status, nature FROM tasks WHERE id = ?", taskId);
        if (taskRows.isEmpty()) throw new NotFoundException("任务不存在：" + taskId);
        Map<String, Object> taskRow = taskRows.get(0);
        if (TaskStore.isSealed(taskRow)) {
            String taskStatus = (String) taskRow.get("status");
            throw new StoreError("已作废".equals(taskStatus)
                ? "已作废的任务不能添加待办"
                : "已完成的任务不能添加待办（维护期除外）");
        }

        Long newId = db.insertReturningId("""
            INSERT INTO todos (task_id, title, description, is_completed, is_abandoned)
            VALUES (?, ?, ?, 0, 0)
            RETURNING id
            """, taskId, t, d);
        if (newId == null) throw new StoreError("写待办失败");
        if (d != null) entityRefStore.syncAllRefs("todo", newId, "description", d);
        publisher.publishEvent(new VectorIndexEvent.Upsert("todo:" + newId, "todo", todoText(t, d)));
        return getTodo(newId);
    }

    /**
     * 修改 title / description（可任一）。处于终态的 todo 不可编辑。
     */
    public Map<String, Object> updateTodo(long todoId, long taskId,
                                          String title, String description) {
        if (title == null && description == null)
            throw new StoreError("至少要改一个字段");
        if (title != null && title.isBlank())
            throw new StoreError("待办标题不能为空");

        StringBuilder sets = new StringBuilder("updated_at = CURRENT_TIMESTAMP");
        List<Object> params = new ArrayList<>();
        if (title != null) {
            sets.append(", title = ?");
            params.add(title.strip());
        }
        if (description != null) {
            String d = description.isBlank() ? null : description.strip();
            sets.append(", description = ?");
            params.add(d);
        }
        params.add(todoId);
        params.add(taskId);
        int n = db.update(
            "UPDATE todos SET " + sets
          + " WHERE id = ? AND task_id = ? AND is_completed = 0 AND is_abandoned = 0"
          + " RETURNING id",
            params.toArray());
        if (n == 0) {
            List<Map<String, Object>> rows = db.query(
                "SELECT 1 FROM todos WHERE id = ? AND task_id = ?", todoId, taskId);
            if (rows.isEmpty())
                throw new NotFoundException("待办不存在或不属于此任务：todo=" + todoId + " task=" + taskId);
            throw new StoreError("已完成/已废弃的 todo 不可编辑");
        }
        if (description != null) {
            String d = description.isBlank() ? "" : description.strip();
            entityRefStore.syncAllRefs("todo", todoId, "description", d);
        }
        Map<String, Object> updated = getTodo(todoId);
        publisher.publishEvent(new VectorIndexEvent.Upsert("todo:" + todoId, "todo",
            todoText((String) updated.get("title"), (String) updated.get("description"))));
        return updated;
    }

    /**
     * 标记为完成。已 abandoned 不可置完成；已 completed 允许幂等。
     */
    public Map<String, Object> completeTodo(long todoId, long taskId) {
        int n = db.update("""
            UPDATE todos
               SET is_completed = 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND task_id = ? AND is_abandoned = 0
             RETURNING id
            """, todoId, taskId);
        if (n == 0) {
            List<Map<String, Object>> rows = db.query(
                "SELECT is_completed, is_abandoned FROM todos WHERE id = ? AND task_id = ?",
                todoId, taskId);
            if (rows.isEmpty())
                throw new NotFoundException("待办不存在或不属于此任务：todo=" + todoId + " task=" + taskId);
            throw new StoreError("已废弃的 todo 不能标记为完成");
        }
        return getTodo(todoId);
    }

    /**
     * 标记为废弃。已 completed 不可废弃；已 abandoned 允许幂等。
     */
    public Map<String, Object> abandonTodo(long todoId, long taskId) {
        int n = db.update("""
            UPDATE todos
               SET is_abandoned = 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND task_id = ? AND is_completed = 0
             RETURNING id
            """, todoId, taskId);
        if (n == 0) {
            List<Map<String, Object>> rows = db.query(
                "SELECT is_completed, is_abandoned FROM todos WHERE id = ? AND task_id = ?",
                todoId, taskId);
            if (rows.isEmpty())
                throw new NotFoundException("待办不存在或不属于此任务：todo=" + todoId + " task=" + taskId);
            throw new StoreError("已完成的 todo 不可废弃");
        }
        return getTodo(todoId);
    }

    /** 物理删除（hard delete only）。 */
    public void deleteTodo(long todoId, long taskId) {
        int n = db.update(
            "DELETE FROM todos WHERE id = ? AND task_id = ? RETURNING id",
            todoId, taskId);
        if (n == 0)
            throw new NotFoundException("待办不存在或不属于此任务：todo=" + todoId + " task=" + taskId);
        entityRefStore.removeAll("todo", todoId);
    }

    /**
     * 查询所有未完成的待办（跨任务）。
     * 返回待办及其所属任务信息，按任务 id 和待办创建时间排序。
     * 排除已作废任务的待办。
     */
    public List<Map<String, Object>> listIncompleteTodos() {
        return db.query("""
            SELECT
                todo.id AS todo_id,
                todo.title AS todo_title,
                todo.description AS todo_description,
                todo.created_at AS todo_created_at,
                t.id AS task_id,
                t.title AS task_title,
                t.status AS task_status,
                t.nature AS task_nature
            FROM todos todo
            JOIN tasks t ON t.id = todo.task_id
            WHERE todo.is_completed = 0
              AND todo.is_abandoned = 0
              AND t.status != '已作废'
            ORDER BY t.id ASC, todo.created_at ASC
            """);
    }
}
