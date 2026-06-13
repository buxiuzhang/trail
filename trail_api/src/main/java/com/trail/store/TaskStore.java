package com.trail.store;

import com.trail.db.SqliteDb;
import com.trail.store.exception.DuplicateException;
import com.trail.store.exception.InvalidTransitionException;
import com.trail.store.exception.NotFoundException;
import com.trail.store.exception.StoreError;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 任务 CRUD + 状态机 + 置顶 + 级联硬删（M8 SQLite 适配版）。 */
@Component
public class TaskStore {

    public static final Map<String, Set<String>> ALLOWED_TRANSITIONS = Map.of(
            "未开始", Set.of("进行中", "已作废"),
            "进行中", Set.of("已完成", "已作废"),
            "已完成", Set.of("进行中", "已作废"),
            "已作废", Set.of()
    );

    public static final List<String> TASK_STATUSES = List.of("未开始", "进行中", "已完成", "已作废");
    public static final List<String> TASK_NATURES  = List.of("长期", "临时", "维护");

    private final SqliteDb db;

    public TaskStore(SqliteDb db) {
        this.db = db;
    }

    // ============================================================
    // 查询
    // ============================================================

    /** 旧签名保留（向后兼容）：无 month/tag，无分页。 */
    public List<Map<String, Object>> listTasks(String status, String nature, String search) {
        return listTasksPaged(status, nature, search, null, null, null, null);
    }

    /**
     * 完整筛选 + 分页 + 5 聚合字段：
     *   todo_active_count / todo_completed_count / todo_abandoned_count
     *   log_count / log_main_count
     * 派生自 LEFT JOIN 子查询（与现有 last_log_date 派生风格一致）。
     */
    public List<Map<String, Object>> listTasksPaged(
            String status, String nature, String search,
            String month, String tag,
            Integer limit, Integer offset) {
        // 1) 自动升级：临时任务超过 30 天未完成 → 长期
        db.update(
            "UPDATE tasks SET nature = ?, updated_at = CURRENT_TIMESTAMP"
          + " WHERE nature = ? AND status NOT IN (?, ?)"
          + " AND start_date IS NOT NULL AND start_date < date('now', '-30 days')",
            "长期", "临时", "已完成", "已作废");

        // 2) 主 SQL：派生 last_log_date + 5 聚合
        StringBuilder sql = new StringBuilder("""
            SELECT t.*, sub.last_log_date,
              COALESCE(todo_sub.todo_active_count, 0) AS todo_active_count,
              COALESCE(todo_sub.todo_completed_count, 0) AS todo_completed_count,
              COALESCE(todo_sub.todo_abandoned_count, 0) AS todo_abandoned_count,
              COALESCE(log_sub.log_count, 0) AS log_count,
              COALESCE(log_sub.log_main_count, 0) AS log_main_count
            FROM tasks t
            LEFT JOIN (
                SELECT task_id, MAX(log_date) AS last_log_date
                FROM work_logs WHERE is_deleted = 0
                GROUP BY task_id
            ) sub ON sub.task_id = t.id
            LEFT JOIN (
                SELECT task_id,
                  SUM(CASE WHEN is_completed = 0 AND is_abandoned = 0 THEN 1 ELSE 0 END) AS todo_active_count,
                  SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS todo_completed_count,
                  SUM(CASE WHEN is_abandoned = 1 THEN 1 ELSE 0 END) AS todo_abandoned_count
                FROM todos
                GROUP BY task_id
            ) todo_sub ON todo_sub.task_id = t.id
            LEFT JOIN (
                SELECT task_id,
                  SUM(CASE WHEN is_deleted = 0 THEN 1 ELSE 0 END) AS log_count,
                  SUM(CASE WHEN is_deleted = 0 AND phase = 'main' THEN 1 ELSE 0 END) AS log_main_count
                FROM work_logs
                GROUP BY task_id
            ) log_sub ON log_sub.task_id = t.id
            WHERE 1=1
            """);
        List<Object> params = new java.util.ArrayList<>();
        buildWhereSql(sql, params, status, nature, search, month, tag);
        // SQLite 不支持 NULLS LAST → 改 CASE WHEN x IS NULL THEN 1 ELSE 0 END, x DESC
        sql.append("""
            ORDER BY
              CASE WHEN t.pinned_at IS NULL THEN 1 ELSE 0 END, t.pinned_at DESC,
              CASE t.status
                WHEN '进行中' THEN 0
                WHEN '未开始' THEN 1
                WHEN '已完成' THEN 2
                WHEN '已作废' THEN 3
                ELSE 4
              END,
              CASE WHEN t.start_date IS NULL THEN 1 ELSE 0 END, t.start_date DESC,
              t.title
            """);
        if (limit != null) {
            sql.append(" LIMIT ?");
            params.add(limit);
        }
        if (offset != null) {
            sql.append(" OFFSET ?");
            params.add(offset);
        }
        return db.query(sql.toString(), params.toArray());
    }

    /** 与 listTasksPaged 共享 WHERE 条件；total 与 items 过滤一致。 */
    public long countTasks(String status, String nature, String search, String month, String tag) {
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) AS cnt FROM tasks t WHERE 1=1");
        List<Object> params = new java.util.ArrayList<>();
        buildWhereSql(sql, params, status, nature, search, month, tag);
        List<Map<String, Object>> rows = db.query(sql.toString(), params.toArray());
        if (rows.isEmpty()) return 0L;
        Object v = rows.get(0).get("cnt");
        return v == null ? 0L : ((Number) v).longValue();
    }

    /**
     * 共享 WHERE 条件拼装。listTasksPaged / countTasks 都用，保证 total 与 items 过滤一致。
     *   month: COALESCE(processing_date, start_date) 严格等价前端 || 短路
     *   tag:   tags 列存 JSON 字符串如 ["a","b"]，用 "tag" 包裹匹配（tag 名含 " 或 \ 的边界不严谨）
     */
    private void buildWhereSql(StringBuilder sql, List<Object> params,
                                String status, String nature, String search,
                                String month, String tag) {
        if (status != null && !status.isBlank()) {
            sql.append(" AND t.status = ?");
            params.add(status);
        }
        if (nature != null && !nature.isBlank()) {
            sql.append(" AND t.nature = ?");
            params.add(nature);
        }
        if (search != null && !search.isBlank()) {
            sql.append(" AND t.title LIKE ?");
            params.add("%" + search + "%");
        }
        if (month != null && !month.isBlank()) {
            sql.append(" AND strftime('%Y-%m', COALESCE(t.processing_date, t.start_date)) = ?");
            params.add(month);
        }
        if (tag != null && !tag.isBlank()) {
            sql.append(" AND t.tags LIKE ?");
            params.add("%\"" + tag + "\"%");
        }
    }

    public Map<String, Object> getTask(long taskId) {
        List<Map<String, Object>> rows = db.query("""
            SELECT t.*, sub.last_log_date,
              COALESCE(todo_sub.todo_active_count, 0) AS todo_active_count,
              COALESCE(todo_sub.todo_completed_count, 0) AS todo_completed_count,
              COALESCE(todo_sub.todo_abandoned_count, 0) AS todo_abandoned_count,
              COALESCE(log_sub.log_count, 0) AS log_count,
              COALESCE(log_sub.log_main_count, 0) AS log_main_count
            FROM tasks t
            LEFT JOIN (
                SELECT task_id, MAX(log_date) AS last_log_date
                FROM work_logs WHERE is_deleted = 0
                GROUP BY task_id
            ) sub ON sub.task_id = t.id
            LEFT JOIN (
                SELECT task_id,
                  SUM(CASE WHEN is_completed = 0 AND is_abandoned = 0 THEN 1 ELSE 0 END) AS todo_active_count,
                  SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS todo_completed_count,
                  SUM(CASE WHEN is_abandoned = 1 THEN 1 ELSE 0 END) AS todo_abandoned_count
                FROM todos
                GROUP BY task_id
            ) todo_sub ON todo_sub.task_id = t.id
            LEFT JOIN (
                SELECT task_id,
                  SUM(CASE WHEN is_deleted = 0 THEN 1 ELSE 0 END) AS log_count,
                  SUM(CASE WHEN is_deleted = 0 AND phase = 'main' THEN 1 ELSE 0 END) AS log_main_count
                FROM work_logs
                GROUP BY task_id
            ) log_sub ON log_sub.task_id = t.id
            WHERE t.id = ?
            """, taskId);
        if (rows.isEmpty()) throw new NotFoundException("任务不存在：" + taskId);
        return rows.get(0);
    }

    // ============================================================
    // 创建
    // ============================================================

    public Map<String, Object> createTask(
            String title, String nature, String alias, String description,
            LocalDate startDate, LocalDate processingDate, String status, List<String> tags) {
        if (title == null || title.isBlank()) throw new StoreError("标题不能为空");
        if (status == null || !TASK_STATUSES.contains(status))
            throw new StoreError("非法状态：" + status);
        if (nature == null || !TASK_NATURES.contains(nature))
            throw new StoreError("非法性质：" + nature);

        if (!db.query("SELECT 1 FROM tasks WHERE title = ?", title.trim()).isEmpty()) {
            throw new DuplicateException("任务已存在：" + title);
        }

        // start_date 默认为今天
        LocalDate effectiveStartDate = (startDate != null) ? startDate : LocalDate.now();

        // SQLite AUTOINCREMENT 自动生成 id；RETURNING id 仍可用（3.35+）
        Long newId = db.insertReturningId("""
            INSERT INTO tasks (
                title, alias, description,
                start_date, processing_date, status, nature, tags
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            title.trim(),
            (alias == null || alias.isBlank()) ? null : alias.trim(),
            description,
            effectiveStartDate,
            processingDate,
            status,
            nature,
            tags == null ? List.of() : tags
        );
        if (newId == null) throw new StoreError("创建任务失败");
        return getTask(newId);
    }

    // ============================================================
    // 更新
    // ============================================================

    public Map<String, Object> updateTask(long taskId, Map<String, Object> fields) {
        Set<String> allowed = Set.of(
                "title", "alias", "description",
                "start_date", "processing_date", "end_date",
                "nature", "summary", "maintenance_summary",
                "tags"
        );
        Set<String> bad = new java.util.HashSet<>(fields.keySet());
        bad.removeAll(allowed);
        if (!bad.isEmpty()) throw new StoreError("不允许通过 update_task 改字段：" + bad);

        if (fields.containsKey("title")) {
            String t = (String) fields.get("title");
            if (t == null || t.isBlank()) throw new StoreError("标题不能为空");
            fields.put("title", t.trim());
        }
        if (fields.containsKey("alias") && fields.get("alias") instanceof String a) {
            fields.put("alias", a.isBlank() ? null : a.trim());
        }
        if (fields.containsKey("nature") && !TASK_NATURES.contains((String) fields.get("nature"))) {
            throw new StoreError("非法性质：" + fields.get("nature"));
        }

        if (fields.isEmpty()) return getTask(taskId);

        StringBuilder sets = new StringBuilder();
        List<Object> params = new java.util.ArrayList<>();
        boolean first = true;
        for (Map.Entry<String, Object> e : fields.entrySet()) {
            if (!first) sets.append(", ");
            sets.append(e.getKey()).append(" = ?");
            params.add(e.getValue());
            first = false;
        }
        sets.append(", updated_at = CURRENT_TIMESTAMP");
        params.add(taskId);

        int affected = db.update("UPDATE tasks SET " + sets + " WHERE id = ?", params.toArray());
        if (affected == 0) throw new NotFoundException("任务不存在：" + taskId);
        return getTask(taskId);
    }

    // ============================================================
    // 状态转移
    // ============================================================

    public Map<String, Object> changeStatus(long taskId, String newStatus,
                                            LocalDate endDate, boolean maintenance) {
        if (newStatus == null || !TASK_STATUSES.contains(newStatus))
            throw new StoreError("非法状态：" + newStatus);

        Map<String, Object> task = getTask(taskId);
        String old = (String) task.get("status");

        if (old.equals(newStatus) && !maintenance) return task;
        if (!isValidTransition(old, newStatus))
            throw new InvalidTransitionException("非法转移：" + old + " → " + newStatus);

        StringBuilder sets = new StringBuilder("status = ?");
        List<Object> params = new java.util.ArrayList<>();
        params.add(newStatus);

        if ("已完成".equals(newStatus)) {
            sets.append(", end_date = ?");
            params.add(endDate != null ? endDate : LocalDate.now());
            if (maintenance) {
                sets.append(", nature = ?");
                params.add("维护");
            }
        }
        if ("已作废".equals(newStatus)) {
            sets.append(", end_date = NULL");
        }
        sets.append(", updated_at = CURRENT_TIMESTAMP");
        params.add(taskId);

        db.update("UPDATE tasks SET " + sets + " WHERE id = ?", params.toArray());
        return getTask(taskId);
    }

    public Map<String, Object> cancelTask(long taskId) {
        return changeStatus(taskId, "已作废", null, false);
    }

    // ============================================================
    // 置顶
    // ============================================================

    public Map<String, Object> pin(long taskId) {
        int affected = db.update(
            "UPDATE tasks SET pinned_at = COALESCE(pinned_at, CURRENT_TIMESTAMP)"
          + " WHERE id = ? RETURNING id", taskId);
        if (affected == 0) throw new NotFoundException("任务不存在：" + taskId);
        return getTask(taskId);
    }

    public Map<String, Object> unpin(long taskId) {
        int affected = db.update(
            "UPDATE tasks SET pinned_at = NULL WHERE id = ? RETURNING id", taskId);
        if (affected == 0) throw new NotFoundException("任务不存在：" + taskId);
        return getTask(taskId);
    }

    // ============================================================
    // 硬删
    // ============================================================

    public void deleteTask(long taskId) {
        if (db.query("SELECT 1 FROM tasks WHERE id = ?", taskId).isEmpty()) {
            throw new NotFoundException("任务不存在：" + taskId);
        }
        db.runInTransaction(con -> {
            try {
                var p0 = con.prepareStatement("DELETE FROM todos WHERE task_id = ?");
                p0.setObject(1, taskId);
                p0.executeUpdate();
                var p1 = con.prepareStatement("DELETE FROM contact_channels WHERE task_id = ?");
                p1.setObject(1, taskId);
                p1.executeUpdate();
                var p2 = con.prepareStatement("DELETE FROM work_logs WHERE task_id = ?");
                p2.setObject(1, taskId);
                p2.executeUpdate();
                var p3 = con.prepareStatement("DELETE FROM ai_records WHERE task_id = ?");
                p3.setObject(1, taskId);
                p3.executeUpdate();
                var p4 = con.prepareStatement("DELETE FROM tasks WHERE id = ?");
                p4.setObject(1, taskId);
                int n = p4.executeUpdate();
                if (n == 0) throw new NotFoundException("任务不存在：" + taskId);
            } catch (java.sql.SQLException e) {
                throw new RuntimeException("deleteTask 失败: " + e.getMessage(), e);
            }
            return null;
        });
    }

    // ============================================================
    public static boolean isValidTransition(String from, String to) {
        if (from.equals(to)) return true;
        return ALLOWED_TRANSITIONS.getOrDefault(from, Set.of()).contains(to);
    }
}
