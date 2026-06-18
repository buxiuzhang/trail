package com.trail.web.controller;

import com.trail.store.TaskStore;
import com.trail.store.WorkLogStore;
import com.trail.web.dto.LogCreateRequest;
import com.trail.web.dto.LogMapper;
import com.trail.web.dto.LogResponse;
import com.trail.web.dto.LogUpdateRequest;
import com.trail.web.dto.PagedResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/tasks/{taskId}/logs")
@Tag(name = "工作日志", description = "任务下的工作日志（日报）管理，包括添加、编辑、删除日志")
public class WorkLogController {

    private final WorkLogStore logs;
    private final TaskStore tasks;

    public WorkLogController(WorkLogStore logs, TaskStore tasks) {
        this.logs = logs;
        this.tasks = tasks;
    }

    @Operation(summary = "查询任务的工作日志", description = "获取指定任务的工作日志，支持分页。默认 limit=5；不传 limit 时返回全量。")
    @GetMapping
    public PagedResponse<LogResponse> list(
            @Parameter(description = "任务 ID")
            @PathVariable long taskId,
            @Parameter(description = "按阶段筛选：main（主体阶段）或 maintenance（维护阶段）")
            @RequestParam(required = false) String phase,
            @Parameter(description = "是否包含已删除的日志")
            @RequestParam(defaultValue = "false") boolean includeDeleted,
            @Parameter(description = "每页条数，不传返回全量")
            @RequestParam(required = false) Integer limit,
            @Parameter(description = "偏移量")
            @RequestParam(defaultValue = "0") int offset) {
        int effectiveLimit = (limit == null) ? Integer.MAX_VALUE : limit;
        long total = logs.countLogs(taskId, phase, includeDeleted);
        List<LogResponse> items = logs.listLogs(taskId, phase, includeDeleted, null, effectiveLimit, offset)
                .stream()
                .map(row -> {
                    long logId = ((Number) row.get("id")).longValue();
                    List<Long> todoIds = logs.getTodoIdsForLog(logId);
                    List<Long> taskIds = logs.getTaskIdsForLog(logId);
                    return LogMapper.toResponse(row, todoIds, taskIds);
                })
                .toList();
        return new PagedResponse<>(items, total);
    }

    @Operation(summary = "添加工作日志（日报）", description = "为指定任务添加一条工作日志。如果是该任务的第一条日志，任务状态会自动从「未开始」变为「进行中」。")
    @PostMapping
    public ResponseEntity<LogResponse> add(
            @Parameter(description = "任务 ID")
            @PathVariable long taskId,
            @Parameter(description = "日志内容，包含 log_date（日期 YYYY-MM-DD）、content（日志内容）、phase（阶段，默认 main）、hours（工时，默认 1.0）、todoIds（关联待办 ID 列表）、taskIds（关联任务 ID 列表）")
            @RequestBody LogCreateRequest req) {
        String phase = req.phase() == null ? "main" : req.phase();
        var created = logs.addLog(taskId, req.logDate(), req.content(), phase, req.hours(), req.todoIds(), req.taskIds());
        // 首日志：未开始 → 进行中
        var task = tasks.getTask(taskId);
        if ("未开始".equals(task.get("status"))) {
            tasks.changeStatus(taskId, "进行中", null, false);
        }
        long logId = ((Number) created.get("id")).longValue();
        List<Long> todoIds = logs.getTodoIdsForLog(logId);
        List<Long> taskIds = logs.getTaskIdsForLog(logId);
        return ResponseEntity.status(HttpStatus.CREATED).body(LogMapper.toResponse(created, todoIds, taskIds));
    }

    @Operation(summary = "编辑工作日志", description = "修改已有工作日志的内容、日期、阶段、工时或关联待办。")
    @PutMapping("/{logId}")
    public LogResponse update(
            @Parameter(description = "任务 ID")
            @PathVariable long taskId,
            @Parameter(description = "日志 ID")
            @PathVariable long logId,
            @Parameter(description = "要修改的字段，包含 content（内容）、log_date（日期）、phase（阶段）、hours（工时）、todoIds（关联待办 ID 列表）、taskIds（关联任务 ID 列表）")
            @RequestBody LogUpdateRequest req) {
        var updated = logs.updateLog(logId, taskId, req.content(), req.logDate(), req.phase(), req.hours(), req.todoIds(), req.taskIds());
        List<Long> todoIds = logs.getTodoIdsForLog(logId);
        List<Long> taskIds = logs.getTaskIdsForLog(logId);
        return LogMapper.toResponse(updated, todoIds, taskIds);
    }

    @Operation(summary = "删除工作日志", description = "删除指定的工作日志。默认软删除（标记为已删除），hard=true 时永久删除。")
    @DeleteMapping("/{logId}")
    public ResponseEntity<Void> delete(
            @Parameter(description = "任务 ID")
            @PathVariable long taskId,
            @Parameter(description = "日志 ID")
            @PathVariable long logId,
            @Parameter(description = "是否硬删除（永久删除），默认 false 为软删除")
            @RequestParam(defaultValue = "false") boolean hard) {
        logs.deleteLog(logId, taskId, hard);
        return ResponseEntity.noContent().build();
    }
}
