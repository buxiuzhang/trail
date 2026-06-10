package com.trail.web.dto;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.Map;

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

    private static Long asLong(Object o) { return o == null ? null : ((Number) o).longValue(); }
    private static Boolean asBool(Object o) {
        if (o == null) return Boolean.FALSE;
        if (o instanceof Number n) return n.intValue() != 0;
        if (o instanceof Boolean b) return b;
        return "1".equals(o.toString()) || "true".equalsIgnoreCase(o.toString());
    }
    private static String asString(Object o) { return o == null ? null : o.toString(); }
    private static Instant asInstant(Object o) {
        if (o == null) return null;
        if (o instanceof java.sql.Timestamp t) return t.toInstant();
        if (o instanceof Instant i) return i;
        if (o instanceof OffsetDateTime odt) return odt.toInstant();
        String s = o.toString();
        try { return OffsetDateTime.parse(s).toInstant(); }
        catch (DateTimeParseException ignored) {}
        String t = s.indexOf(' ') >= 0 ? s.replace(' ', 'T') : s;
        try { return LocalDateTime.parse(t).toInstant(ZoneOffset.UTC); }
        catch (DateTimeParseException ignored) {}
        try { return Instant.parse(t); }
        catch (DateTimeParseException ignored) {}
        return null;
    }
}
