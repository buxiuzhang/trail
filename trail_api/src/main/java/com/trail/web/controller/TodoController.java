package com.trail.web.controller;

import com.trail.store.TodoStore;
import com.trail.web.dto.TodoMapper;
import com.trail.web.dto.TodoRequest;
import com.trail.web.dto.TodoResponse;
import com.trail.web.dto.TodoUpdateRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** 任务待办（M9：详情页 header 下方区块）。 */
@RestController
@RequestMapping("/api/tasks/{taskId}/todos")
public class TodoController {

    private final TodoStore todos;

    public TodoController(TodoStore todos) {
        this.todos = todos;
    }

    @GetMapping
    public List<TodoResponse> list(@PathVariable long taskId) {
        return todos.listTodos(taskId).stream().map(TodoMapper::toResponse).toList();
    }

    @PostMapping
    public ResponseEntity<TodoResponse> add(@PathVariable long taskId,
                                            @RequestBody @Valid TodoRequest req) {
        var created = todos.addTodo(taskId, req.title(), req.description());
        return ResponseEntity.status(HttpStatus.CREATED).body(TodoMapper.toResponse(created));
    }

    @PutMapping("/{todoId}")
    public TodoResponse update(@PathVariable long taskId, @PathVariable long todoId,
                               @RequestBody @Valid TodoUpdateRequest req) {
        return TodoMapper.toResponse(
            todos.updateTodo(todoId, taskId, req.title(), req.description()));
    }

    /** 标记完成（单向终态：已废弃不可再置完成；已完成的允许幂等）。 */
    @PutMapping("/{todoId}/complete")
    public TodoResponse complete(@PathVariable long taskId, @PathVariable long todoId) {
        return TodoMapper.toResponse(todos.completeTodo(todoId, taskId));
    }

    /** 标记废弃（单向终态：已完成不可再废弃；已废弃的允许幂等）。 */
    @PutMapping("/{todoId}/abandon")
    public TodoResponse abandon(@PathVariable long taskId, @PathVariable long todoId) {
        return TodoMapper.toResponse(todos.abandonTodo(todoId, taskId));
    }

    /** 物理删除（前端不再展示）。 */
    @DeleteMapping("/{todoId}")
    public ResponseEntity<Void> delete(@PathVariable long taskId, @PathVariable long todoId) {
        todos.deleteTodo(todoId, taskId);
        return ResponseEntity.noContent().build();
    }
}
