package com.trail.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.trail.db.SqliteDb;
import com.trail.service.LlmService;
import com.trail.store.InsightStore;
import com.trail.store.TaskStore;
import com.trail.store.TodoStore;
import com.trail.store.WorkLogStore;
import com.trail.store.exception.NotFoundException;
import com.trail.store.exception.StoreError;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 工具执行器
 * 根据 LLM 的工具调用请求，执行对应的数据操作
 * 查询类工具只读，create_work_log 为写入工具（需用户确认）
 */
@Component
public class ToolExecutor {

    private final TaskStore taskStore;
    private final WorkLogStore workLogStore;
    private final TodoStore todoStore;
    private final InsightStore insightStore;
    private final LlmService llmService;
    private final SqliteDb db;
    private final ObjectMapper mapper;

    public ToolExecutor(
        TaskStore taskStore,
        WorkLogStore workLogStore,
        TodoStore todoStore,
        InsightStore insightStore,
        @Lazy LlmService llmService,
        SqliteDb db,
        ObjectMapper mapper
    ) {
        this.taskStore = taskStore;
        this.workLogStore = workLogStore;
        this.todoStore = todoStore;
        this.insightStore = insightStore;
        this.llmService = llmService;
        this.db = db;
        this.mapper = mapper;
    }

    /**
     * 执行工具调用
     * @param name 工具名称
     * @param input 输入参数
     * @return JSON 字符串结果
     */
    public String execute(String name, Map<String, Object> input) {
        try {
            Object result = switch (name) {
                case "list_tasks" -> executeListTasks(input);
                case "list_logs_by_date" -> executeListLogsByDate(input);
                case "list_recent_logs" -> executeListRecentLogs(input);
                case "get_task_detail" -> executeGetTaskDetail(input);
                case "count_tasks_by_status" -> executeCountTasksByStatus();
                case "ask_maintenance_suggestion" -> executeAskMaintenanceSuggestion(input);
                case "list_todos_by_task" -> executeListTodosByTask(input);
                case "list_incomplete_todos" -> executeListIncompleteTodos();
                case "create_work_log" -> executeCreateWorkLog(input);
                default -> throw new IllegalArgumentException("未知工具：" + name);
            };
            return toJson(result);
        } catch (NotFoundException e) {
            // 任务/日志不存在，返回错误信息
            return toJson(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            return toJson(Map.of("error", "工具执行失败：" + e.getMessage()));
        }
    }

    // ============================================================
    // 工具实现
    // ============================================================

    private List<Map<String, Object>> executeListTasks(Map<String, Object> input) {
        String status = (String) input.get("status");
        String nature = (String) input.get("nature");
        String search = (String) input.get("search");
        List<Map<String, Object>> tasks = taskStore.listTasks(status, nature, search);
        // 上限 20 条
        if (tasks.size() > 20) {
            tasks = tasks.subList(0, 20);
        }
        return tasks;
    }

    /**
     * 按日期查询日志，按任务分组
     * 参考 Python 实现：JOIN tasks 表获取任务信息
     */
    private List<Map<String, Object>> executeListLogsByDate(Map<String, Object> input) {
        String logDateStr = (String) input.get("log_date");
        String phase = (String) input.get("phase");

        if (logDateStr == null || logDateStr.isBlank()) {
            return List.of(Map.of("error", "log_date 参数必填"));
        }

        StringBuilder sql = new StringBuilder("""
            SELECT
                w.id AS log_id,
                w.log_date,
                w.phase,
                w.ordinal,
                w.content,
                t.id AS task_id,
                t.title AS task_title,
                t.status AS task_status,
                t.nature AS task_nature
            FROM work_logs w
            JOIN tasks t ON t.id = w.task_id
            WHERE w.log_date = ? AND w.is_deleted = 0
            """);
        List<Object> params = new java.util.ArrayList<>();
        params.add(logDateStr);

        if (phase != null && !phase.isBlank()) {
            sql.append(" AND w.phase = ?");
            params.add(phase);
        }

        sql.append(" ORDER BY t.id, w.ordinal");

        List<Map<String, Object>> rows = db.query(sql.toString(), params.toArray());

        // 按 task_id 分组
        Map<Long, Map<String, Object>> grouped = new HashMap<>();
        for (Map<String, Object> row : rows) {
            Long taskId = ((Number) row.get("task_id")).longValue();
            Map<String, Object> group = grouped.computeIfAbsent(taskId, k -> {
                Map<String, Object> g = new HashMap<>();
                g.put("task_id", taskId);
                g.put("task_title", row.get("task_title"));
                g.put("task_status", row.get("task_status"));
                g.put("task_nature", row.get("task_nature"));
                g.put("logs", new java.util.ArrayList<>());
                return g;
            });
            // 提取日志信息
            Map<String, Object> logEntry = new HashMap<>();
            logEntry.put("log_id", row.get("log_id"));
            logEntry.put("log_date", row.get("log_date"));
            logEntry.put("phase", row.get("phase"));
            logEntry.put("ordinal", row.get("ordinal"));
            logEntry.put("content", truncateContent((String) row.get("content"), 800));
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> logsList = (List<Map<String, Object>>) group.get("logs");
            logsList.add(logEntry);
        }

        return List.copyOf(grouped.values());
    }

    private List<Map<String, Object>> executeListRecentLogs(Map<String, Object> input) {
        Object taskIdObj = input.get("task_id");
        if (taskIdObj == null) {
            return List.of(Map.of("error", "task_id 参数必填"));
        }
        long taskId = ((Number) taskIdObj).longValue();

        Integer sinceDays = input.containsKey("since_days")
            ? ((Number) input.get("since_days")).intValue() : 30;
        Integer limit = input.containsKey("limit")
            ? ((Number) input.get("limit")).intValue() : 5;
        String phase = (String) input.get("phase");

        // 上限 20
        limit = Math.min(limit, 20);

        List<Map<String, Object>> logs = workLogStore.listLogs(
            taskId, phase, false, sinceDays, limit
        );

        // content 截断 800 字
        for (Map<String, Object> log : logs) {
            String content = (String) log.get("content");
            log.put("content", truncateContent(content, 800));
        }

        return logs;
    }

    private Map<String, Object> executeGetTaskDetail(Map<String, Object> input) {
        Object taskIdObj = input.get("task_id");
        if (taskIdObj == null) {
            return Map.of("error", "task_id 参数必填");
        }
        long taskId = ((Number) taskIdObj).longValue();
        return taskStore.getTask(taskId);
    }

    private Map<String, Object> executeCountTasksByStatus() {
        return insightStore.overview();
    }

    /**
     * 维护建议：调用 LLM 服务
     */
    private Map<String, Object> executeAskMaintenanceSuggestion(Map<String, Object> input) {
        Object taskIdObj = input.get("task_id");
        if (taskIdObj == null) {
            return Map.of("error", "task_id 参数必填");
        }
        long taskId = ((Number) taskIdObj).longValue();

        String suggestion = llmService.askMaintenance(taskId);
        return Map.of("suggestion", suggestion);
    }

    private List<Map<String, Object>> executeListTodosByTask(Map<String, Object> input) {
        Object taskIdObj = input.get("task_id");
        if (taskIdObj == null) {
            return List.of(Map.of("error", "task_id 参数必填"));
        }
        long taskId = ((Number) taskIdObj).longValue();
        return todoStore.listTodos(taskId);
    }

    private List<Map<String, Object>> executeListIncompleteTodos() {
        return todoStore.listIncompleteTodos();
    }

    // ============================================================
    // 日志录入工具
    // ============================================================

    /**
     * 创建工作日志（写入）
     * 仅在用户明确确认后由 LLM 调用
     */
    private Map<String, Object> executeCreateWorkLog(Map<String, Object> input) {
        Object taskIdObj = input.get("task_id");
        if (taskIdObj == null) {
            return Map.of("error", "task_id 参数必填");
        }
        long taskId = ((Number) taskIdObj).longValue();

        String content = (String) input.get("content");
        if (content == null || content.isBlank()) {
            return Map.of("error", "content 参数必填");
        }

        String logDateStr = (String) input.get("log_date");
        if (logDateStr == null || logDateStr.isBlank()) {
            return Map.of("error", "log_date 参数必填");
        }
        LocalDate logDate = LocalDate.parse(logDateStr);

        String phase = (String) input.get("phase");
        if (phase == null || phase.isBlank()) {
            phase = "main";
        }

        try {
            Map<String, Object> log = workLogStore.addLog(taskId, logDate, content, phase);
            return Map.of(
                "success", true,
                "log_id", log.get("id"),
                "task_id", taskId,
                "log_date", logDateStr
            );
        } catch (StoreError e) {
            return Map.of("error", "写入失败：" + e.getMessage());
        } catch (NotFoundException e) {
            return Map.of("error", "任务不存在：" + taskId);
        }
    }

    // ============================================================
    // Helper
    // ============================================================

    private String truncateContent(String content, int maxLen) {
        if (content == null) return "";
        if (content.length() <= maxLen) return content;
        return content.substring(0, maxLen) + "…";
    }

    private String toJson(Object obj) {
        try {
            return mapper.writeValueAsString(obj);
        } catch (Exception e) {
            return "{\"error\":\"序列化失败\"}";
        }
    }
}