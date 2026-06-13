package com.trail.web.controller;

import com.trail.store.ContactStore;
import com.trail.store.TaskStore;
import com.trail.web.dto.ContactDto;
import com.trail.web.dto.PagedResponse;
import com.trail.web.dto.StatusChangeRequest;
import com.trail.web.dto.TaskCreateRequest;
import com.trail.web.dto.TaskMapper;
import com.trail.web.dto.TaskResponse;
import com.trail.web.dto.TaskUpdateRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tasks")
@Tag(name = "任务管理", description = "任务的增删改查、状态变更、置顶等操作")
public class TaskController {

    private final TaskStore tasks;
    private final ContactStore contacts;

    public TaskController(TaskStore tasks, ContactStore contacts) {
        this.tasks = tasks;
        this.contacts = contacts;
    }

    @Operation(summary = "查询任务列表", description = "根据条件筛选任务，支持按状态、性质、月份、标签、关键词模糊匹配。默认分页 limit=5；不传 limit 时返回全量（向后兼容）。")
    @GetMapping
    public PagedResponse<TaskResponse> list(
            @Parameter(description = "按状态筛选：未开始、进行中、已完成、已作废")
            @RequestParam(required = false) String status,
            @Parameter(description = "按性质筛选：长期、临时、维护")
            @RequestParam(required = false) String nature,
            @Parameter(description = "标题关键词模糊匹配")
            @RequestParam(required = false) String search,
            @Parameter(description = "按月份筛选：YYYY-MM，匹配 processing_date || start_date")
            @RequestParam(required = false) String month,
            @Parameter(description = "按标签筛选：JSON 字符串包含匹配")
            @RequestParam(required = false) String tag,
            @Parameter(description = "每页条数（不传则 999999，向后兼容全量）")
            @RequestParam(required = false) Integer limit,
            @Parameter(description = "偏移量（默认 0）")
            @RequestParam(required = false) Integer offset) {
        int effectiveLimit = (limit == null) ? Integer.MAX_VALUE : limit;
        int effectiveOffset = (offset == null) ? 0 : offset;

        List<Map<String, Object>> rows = tasks.listTasksPaged(
                status, nature, search, month, tag, effectiveLimit, effectiveOffset);
        long total = tasks.countTasks(status, nature, search, month, tag);

        // 一次 IN 批量查 contacts，替代 N+1
        List<Long> ids = rows.stream()
                .map(r -> ((Number) r.get("id")).longValue())
                .toList();
        Map<Long, List<Map<String, Object>>> contactsByTask = contacts.listContactsBulk(ids);

        List<TaskResponse> items = rows.stream()
                .map(r -> {
                    long id = ((Number) r.get("id")).longValue();
                    List<ContactDto> cs = contactsByTask.getOrDefault(id, List.of()).stream()
                            .map(TaskMapper::contactToDto)
                            .toList();
                    return TaskMapper.toResponse(r, cs);
                })
                .toList();
        return new PagedResponse<>(items, total);
    }

    @Operation(summary = "创建新任务", description = "创建一个新的任务。需要提供标题，其他字段可选。")
    @PostMapping
    public ResponseEntity<TaskResponse> create(
            @Parameter(description = "任务创建信息，包含标题、性质、别名、描述、开始日期等")
            @RequestBody TaskCreateRequest req) {
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

    @Operation(summary = "获取任务详情", description = "根据任务 ID 获取任务的完整信息，包括标题、状态、性质、日期、摘要、标签、对接人等。")
    @GetMapping("/{id}")
    public TaskResponse get(
            @Parameter(description = "任务 ID")
            @PathVariable long id) {
        return withContacts(tasks.getTask(id));
    }

    @Operation(summary = "更新任务信息", description = "更新任务的各种属性，如标题、描述、日期、摘要等。如果要改变状态，建议使用 /{id}/status 接口。")
    @PutMapping("/{id}")
    public TaskResponse update(
            @Parameter(description = "任务 ID")
            @PathVariable long id,
            @Parameter(description = "要更新的字段")
            @RequestBody TaskUpdateRequest req) {
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

    @Operation(summary = "变更任务状态", description = "将任务状态改为新状态（进行中→已完成→已作废等）。如果改为已完成，可以同时填写总结。")
    @PostMapping("/{id}/status")
    public TaskResponse changeStatus(
            @Parameter(description = "任务 ID")
            @PathVariable long id,
            @Parameter(description = "状态变更请求，包含新状态、结束日期、是否进入维护期、总结等")
            @RequestBody StatusChangeRequest req) {
        var result = tasks.changeStatus(id, req.newStatus(), req.endDate(),
                Boolean.TRUE.equals(req.maintenance()));
        // 同步 summary（如果传了）
        if (req.summary() != null && "已完成".equals(req.newStatus())) {
            result = tasks.updateTask(id, Map.of("summary", req.summary()));
        }
        return withContacts(result);
    }

    @Operation(summary = "作废任务", description = "将任务标记为已作废状态。适用于任务不再需要继续的情况。")
    @PostMapping("/{id}/cancel")
    public TaskResponse cancel(
            @Parameter(description = "任务 ID")
            @PathVariable long id) {
        return withContacts(tasks.cancelTask(id));
    }

    @Operation(summary = "删除任务", description = "永久删除任务及其关联的工作日志、待办、联系人等所有数据。此操作不可恢复，谨慎使用。")
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @Parameter(description = "任务 ID")
            @PathVariable long id) {
        tasks.deleteTask(id);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "置顶任务", description = "将任务置顶到列表首位，方便快速访问。")
    @PostMapping("/{id}/pin")
    public TaskResponse pin(
            @Parameter(description = "任务 ID")
            @PathVariable long id) {
        return withContacts(tasks.pin(id));
    }

    @Operation(summary = "取消置顶", description = "取消任务的置顶状态，恢复到正常排序位置。")
    @PostMapping("/{id}/unpin")
    public TaskResponse unpin(
            @Parameter(description = "任务 ID")
            @PathVariable long id) {
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
