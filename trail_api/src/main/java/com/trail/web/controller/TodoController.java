package com.trail.web.controller;

import com.trail.store.TodoStore;
import com.trail.store.WorkLogStore;
import com.trail.web.dto.TodoMapper;
import com.trail.web.dto.TodoRequest;
import com.trail.web.dto.TodoResponse;
import com.trail.web.dto.TodoUpdateRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 任务待办管理
 * 待办有三种终态：未完成、已完成、已废弃
 */
@RestController
@RequestMapping("/api/tasks/{taskId}/todos")
@Tag(name = "待办事项", description = "任务下的待办事项管理，包括添加、编辑、完成、废弃待办")
public class TodoController {

    private final TodoStore todos;
    private final WorkLogStore workLogs;

    public TodoController(TodoStore todos, WorkLogStore workLogs) {
        this.todos = todos;
        this.workLogs = workLogs;
    }

    @Operation(summary = "查询任务的待办列表", description = "获取指定任务的所有待办事项，包括未完成、已完成、已废弃三种状态。")
    @GetMapping
    public List<TodoResponse> list(
            @Parameter(description = "任务 ID")
            @PathVariable long taskId) {
        return todos.listTodos(taskId).stream().map(TodoMapper::toResponse).toList();
    }

    @Operation(summary = "添加待办事项", description = "为指定任务添加一条新的待办事项。")
    @PostMapping
    public ResponseEntity<TodoResponse> add(
            @Parameter(description = "任务 ID")
            @PathVariable long taskId,
            @Parameter(description = "待办内容，包含 title（标题）、description（补充说明，可选）")
            @RequestBody @Valid TodoRequest req) {
        var created = todos.addTodo(taskId, req.title(), req.description());
        return ResponseEntity.status(HttpStatus.CREATED).body(TodoMapper.toResponse(created));
    }

    @Operation(summary = "编辑待办事项", description = "修改待办事项的标题或补充说明。")
    @PutMapping("/{todoId}")
    public TodoResponse update(
            @Parameter(description = "任务 ID")
            @PathVariable long taskId,
            @Parameter(description = "待办 ID")
            @PathVariable long todoId,
            @Parameter(description = "要修改的字段，包含 title（标题）、description（补充说明）")
            @RequestBody @Valid TodoUpdateRequest req) {
        return TodoMapper.toResponse(
            todos.updateTodo(todoId, taskId, req.title(), req.description()));
    }

    @Operation(summary = "完成待办", description = "将待办事项标记为已完成。已废弃的待办不能再标记完成。")
    @PutMapping("/{todoId}/complete")
    public TodoResponse complete(
            @Parameter(description = "任务 ID")
            @PathVariable long taskId,
            @Parameter(description = "待办 ID")
            @PathVariable long todoId) {
        return TodoMapper.toResponse(todos.completeTodo(todoId, taskId));
    }

    @Operation(summary = "废弃待办", description = "将待办事项标记为已废弃（不再需要完成）。已完成的待办不能再标记废弃。")
    @PutMapping("/{todoId}/abandon")
    public TodoResponse abandon(
            @Parameter(description = "任务 ID")
            @PathVariable long taskId,
            @Parameter(description = "待办 ID")
            @PathVariable long todoId) {
        return TodoMapper.toResponse(todos.abandonTodo(todoId, taskId));
    }

    @Operation(summary = "删除待办", description = "永久删除待办事项。此操作不可恢复。")
    @DeleteMapping("/{todoId}")
    public ResponseEntity<Void> delete(
            @Parameter(description = "任务 ID")
            @PathVariable long taskId,
            @Parameter(description = "待办 ID")
            @PathVariable long todoId) {
        todos.deleteTodo(todoId, taskId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "查询待办关联的日志", description = "返回所有引用了该待办的工作日志，最新在前，content 已替换 @todo/@task 为真实标题。")
    @GetMapping("/{todoId}/logs")
    public List<Map<String, Object>> logsForTodo(
            @Parameter(description = "任务 ID")
            @PathVariable long taskId,
            @Parameter(description = "待办 ID")
            @PathVariable long todoId) {
        return workLogs.getLogsForTodo(todoId);
    }
}
