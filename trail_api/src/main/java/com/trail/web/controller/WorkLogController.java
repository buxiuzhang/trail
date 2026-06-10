package com.trail.web.controller;

import com.trail.store.TaskStore;
import com.trail.store.WorkLogStore;
import com.trail.web.dto.LogCreateRequest;
import com.trail.web.dto.LogMapper;
import com.trail.web.dto.LogResponse;
import com.trail.web.dto.LogUpdateRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/tasks/{taskId}/logs")
public class WorkLogController {

    private final WorkLogStore logs;
    private final TaskStore tasks;

    public WorkLogController(WorkLogStore logs, TaskStore tasks) {
        this.logs = logs;
        this.tasks = tasks;
    }

    @GetMapping
    public List<LogResponse> list(@PathVariable long taskId,
                                  @RequestParam(required = false) String phase,
                                  @RequestParam(defaultValue = "false") boolean includeDeleted) {
        return logs.listLogs(taskId, phase, includeDeleted, null, null).stream()
                .map(LogMapper::toResponse).toList();
    }

    @PostMapping
    public ResponseEntity<LogResponse> add(@PathVariable long taskId, @RequestBody LogCreateRequest req) {
        String phase = req.phase() == null ? "main" : req.phase();
        var created = logs.addLog(taskId, req.logDate(), req.content(), phase);
        // 首日志：未开始 → 进行中
        var task = tasks.getTask(taskId);
        if ("未开始".equals(task.get("status"))) {
            tasks.changeStatus(taskId, "进行中", null, false);
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(LogMapper.toResponse(created));
    }

    @PutMapping("/{logId}")
    public LogResponse update(@PathVariable long taskId, @PathVariable long logId,
                              @RequestBody LogUpdateRequest req) {
        return LogMapper.toResponse(logs.updateLog(logId, taskId, req.content(), req.logDate(), req.phase()));
    }

    @DeleteMapping("/{logId}")
    public ResponseEntity<Void> delete(@PathVariable long taskId, @PathVariable long logId,
                                       @RequestParam(defaultValue = "false") boolean hard) {
        logs.deleteLog(logId, taskId, hard);
        return ResponseEntity.noContent().build();
    }
}
