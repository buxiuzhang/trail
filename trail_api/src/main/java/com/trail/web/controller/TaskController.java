package com.trail.web.controller;

import com.trail.store.ContactStore;
import com.trail.store.TaskStore;
import com.trail.web.dto.ContactDto;
import com.trail.web.dto.StatusChangeRequest;
import com.trail.web.dto.TaskCreateRequest;
import com.trail.web.dto.TaskMapper;
import com.trail.web.dto.TaskResponse;
import com.trail.web.dto.TaskUpdateRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskStore tasks;
    private final ContactStore contacts;

    public TaskController(TaskStore tasks, ContactStore contacts) {
        this.tasks = tasks;
        this.contacts = contacts;
    }

    @GetMapping
    public List<TaskResponse> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String nature,
            @RequestParam(required = false) String search) {
        return tasks.listTasks(status, nature, search).stream()
                .map(this::withContacts)
                .toList();
    }

    @PostMapping
    public ResponseEntity<TaskResponse> create(@RequestBody TaskCreateRequest req) {
        var created = tasks.createTask(
                req.title(), req.nature(), req.alias(), req.description(),
                req.startDate(), req.processingDate(), req.status(), req.tags());
        if (req.contacts() != null && !req.contacts().isEmpty()) {
            long taskId = ((Number) created.get("id")).longValue();
            var inserted = contacts.setContacts(taskId, req.contacts().stream().map(this::contactMap).toList());
            return ResponseEntity.status(HttpStatus.CREATED).body(
                    TaskMapper.toResponse(created, inserted.stream().map(TaskMapper::contactToDto).toList()));
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(withContacts(created));
    }

    @GetMapping("/{id}")
    public TaskResponse get(@PathVariable long id) {
        return withContacts(tasks.getTask(id));
    }

    @PutMapping("/{id}")
    public TaskResponse update(@PathVariable long id, @RequestBody TaskUpdateRequest req) {
        Map<String, Object> result;
        if (req.status() != null && !req.status().isBlank()) {
            // status 转移路径
            result = tasks.changeStatus(id, req.status(), req.endDate(), false);
            // 如有其它字段（如 summary / nature / alias 等）继续 update
            Map<String, Object> extras = new HashMap<>();
            if (req.title() != null) extras.put("title", req.title());
            if (req.alias() != null) extras.put("alias", req.alias());
            if (req.description() != null) extras.put("description", req.description());
            if (req.startDate() != null) extras.put("start_date", req.startDate());
            if (req.processingDate() != null) extras.put("processing_date", req.processingDate());
            if (req.nature() != null) extras.put("nature", req.nature());
            if (req.summary() != null) extras.put("summary", req.summary());
            if (req.maintenanceSummary() != null) extras.put("maintenance_summary", req.maintenanceSummary());
            if (req.tags() != null) extras.put("tags", req.tags());
            if (!extras.isEmpty()) result = tasks.updateTask(id, extras);
        } else {
            Map<String, Object> fields = new HashMap<>();
            if (req.title() != null) fields.put("title", req.title());
            if (req.alias() != null) fields.put("alias", req.alias());
            if (req.description() != null) fields.put("description", req.description());
            if (req.startDate() != null) fields.put("start_date", req.startDate());
            if (req.processingDate() != null) fields.put("processing_date", req.processingDate());
            if (req.endDate() != null) fields.put("end_date", req.endDate());
            if (req.nature() != null) fields.put("nature", req.nature());
            if (req.summary() != null) fields.put("summary", req.summary());
            if (req.maintenanceSummary() != null) fields.put("maintenance_summary", req.maintenanceSummary());
            if (req.tags() != null) fields.put("tags", req.tags());
            result = tasks.updateTask(id, fields);
        }
        if (req.contacts() != null) {
            var updatedContacts = contacts.setContacts(id, req.contacts().stream()
                    .map(this::contactMap).toList());
            return TaskMapper.toResponse(result, updatedContacts.stream().map(TaskMapper::contactToDto).toList());
        }
        return withContacts(result);
    }

    @PostMapping("/{id}/status")
    public TaskResponse changeStatus(@PathVariable long id, @RequestBody StatusChangeRequest req) {
        var result = tasks.changeStatus(id, req.newStatus(), req.endDate(),
                Boolean.TRUE.equals(req.maintenance()));
        // 同步 summary（如果传了）
        if (req.summary() != null && "已完成".equals(req.newStatus())) {
            result = tasks.updateTask(id, Map.of("summary", req.summary()));
        }
        return withContacts(result);
    }

    @PostMapping("/{id}/cancel")
    public TaskResponse cancel(@PathVariable long id) {
        return withContacts(tasks.cancelTask(id));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable long id) {
        tasks.deleteTask(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/pin")
    public TaskResponse pin(@PathVariable long id) {
        return withContacts(tasks.pin(id));
    }

    @PostMapping("/{id}/unpin")
    public TaskResponse unpin(@PathVariable long id) {
        return withContacts(tasks.unpin(id));
    }

    // ============================================================
    // 工具
    // ============================================================

    private TaskResponse withContacts(Map<String, Object> row) {
        long id = ((Number) row.get("id")).longValue();
        List<ContactDto> cs = contacts.listContacts(id).stream()
                .map(TaskMapper::contactToDto).toList();
        return TaskMapper.toResponse(row, cs);
    }

    private Map<String, Object> contactMap(ContactDto c) {
        Map<String, Object> m = new HashMap<>();
        m.put("kind", c.kind());
        m.put("channel", c.channel());
        m.put("name", c.name());
        m.put("target", c.target());
        m.put("note", c.note());
        return m;
    }
}
