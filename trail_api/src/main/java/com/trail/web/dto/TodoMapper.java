package com.trail.web.dto;

import java.util.Map;

import static com.trail.web.dto.RowAccessors.*;

/** todos 行 → TodoResponse。 */
public final class TodoMapper {
    private TodoMapper() {}

    public static TodoResponse toResponse(Map<String, Object> row) {
        return new TodoResponse(
                asLong(row.get("id")),
                asLong(row.get("task_id")),
                asString(row.get("title")),
                asString(row.get("description")),
                asBool(row.get("is_completed")),
                asBool(row.get("is_abandoned")),
                asInstant(row.get("created_at")),
                asInstant(row.get("updated_at"))
        );
    }
}
