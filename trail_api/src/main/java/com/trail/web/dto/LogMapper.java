package com.trail.web.dto;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import static com.trail.web.dto.RowAccessors.*;

/** work_logs 行 → LogResponse。 */
public final class LogMapper {
    private LogMapper() {}

    public static LogResponse toResponse(Map<String, Object> row) {
        return toResponse(row, Collections.emptyList(), Collections.emptyList());
    }

    public static LogResponse toResponse(Map<String, Object> row, List<Long> todoIds) {
        return toResponse(row, todoIds, Collections.emptyList());
    }

    public static LogResponse toResponse(Map<String, Object> row, List<Long> todoIds, List<Long> taskIds) {
        return new LogResponse(
                asLong(row.get("id")),
                asLong(row.get("task_id")),
                asLocalDate(row.get("log_date")),
                asString(row.get("phase")),
                asInt(row.get("ordinal")),
                asString(row.get("content")),
                asString(row.get("polished_content")),
                asDouble(row.get("hours")),
                asBool(row.get("is_deleted")),
                asInstant(row.get("deleted_at")),
                asInstant(row.get("updated_at")),
                asInt(row.get("edit_count")),
                asInstant(row.get("created_at")),
                todoIds != null ? todoIds : Collections.emptyList(),
                taskIds != null ? taskIds : Collections.emptyList()
        );
    }
}
