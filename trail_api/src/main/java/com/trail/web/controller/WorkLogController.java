package com.trail.web.controller;

import com.trail.store.EntityRefStore;
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
import java.util.Map;

@RestController
@RequestMapping("/api/tasks/{taskId}/logs")
@Tag(name = "工作日志", description = "任务下的工作日志（日报）管理，包括添加、编辑、删除日志")
public class WorkLogController {

    private final WorkLogStore logs;
    private final TaskStore tasks;
    private final EntityRefStore entityRefs;

    public WorkLogController(WorkLogStore logs, TaskStore tasks, EntityRefStore entityRefs) {
        this.logs = logs;
        this.tasks = tasks;
        this.entityRefs = entityRefs;
    }

    @Operation(summary = "查询任务的工作日志")
    @GetMapping
    public PagedResponse<LogResponse> list(
            @PathVariable long taskId,
            @RequestParam(required = false) String phase,
            @RequestParam(defaultValue = "false") boolean includeDeleted,
            @RequestParam(required = false) Integer limit,
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(defaultValue = "desc") String sort) {
        int effectiveLimit = (limit == null) ? Integer.MAX_VALUE : limit;
        long total = logs.countLogs(taskId, phase, includeDeleted);
        List<Map<String, Object>> rows = logs.listLogs(taskId, phase, includeDeleted, null, effectiveLimit, offset, sort);

        List<Long> logIds = rows.stream().map(r -> ((Number) r.get("id")).longValue()).toList();
        Map<Long, List<Long>> todoIdsByLogId = entityRefs.getRefsForSources("log", logIds, "content", "todo");
        Map<Long, List<Long>> taskIdsByLogId = entityRefs.getRefsForSources("log", logIds, "content", "task");
        Map<Long, List<Long>> attIdsByLogId  = entityRefs.getRefsForSources("log", logIds, "content", "file");

        List<LogResponse> items = rows.stream()
                .map(row -> {
                    long logId = ((Number) row.get("id")).longValue();
                    return LogMapper.toResponse(row,
                        todoIdsByLogId.getOrDefault(logId, List.of()),
                        taskIdsByLogId.getOrDefault(logId, List.of()),
                        attIdsByLogId.getOrDefault(logId, List.of()));
                })
                .toList();
        return new PagedResponse<>(items, total);
    }

    @Operation(summary = "添加工作日志（日报）")
    @PostMapping
    public ResponseEntity<LogResponse> add(
            @PathVariable long taskId,
            @RequestBody LogCreateRequest req) {
        String phase = req.phase() == null ? "main" : req.phase();
        var created = logs.addLog(taskId, req.logDate(), req.content(), phase, req.hours(), req.todoIds(), req.taskIds());
        var task = tasks.getTask(taskId);
        if ("未开始".equals(task.get("status"))) {
            tasks.changeStatus(taskId, "进行中", null, false);
        }
        long logId = ((Number) created.get("id")).longValue();
        return ResponseEntity.status(HttpStatus.CREATED).body(LogMapper.toResponse(created,
            entityRefs.getRefs("log", logId, "content", "todo"),
            entityRefs.getRefs("log", logId, "content", "task"),
            entityRefs.getRefs("log", logId, "content", "file")));
    }

    @Operation(summary = "编辑工作日志")
    @PutMapping("/{logId}")
    public LogResponse update(
            @PathVariable long taskId,
            @PathVariable long logId,
            @RequestBody LogUpdateRequest req) {
        var updated = logs.updateLog(logId, taskId, req.content(), req.logDate(), req.phase(), req.hours(), req.todoIds(), req.taskIds());
        return LogMapper.toResponse(updated,
            entityRefs.getRefs("log", logId, "content", "todo"),
            entityRefs.getRefs("log", logId, "content", "task"),
            entityRefs.getRefs("log", logId, "content", "file"));
    }

    @Operation(summary = "删除工作日志")
    @DeleteMapping("/{logId}")
    public ResponseEntity<Void> delete(
            @PathVariable long taskId,
            @PathVariable long logId,
            @RequestParam(defaultValue = "false") boolean hard) {
        logs.deleteLog(logId, taskId, hard);
        return ResponseEntity.noContent().build();
    }
}
