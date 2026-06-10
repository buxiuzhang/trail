package com.trail.web.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.Map;

/** work_logs 行 → LogResponse。 */
public final class LogMapper {
    private LogMapper() {}

    public static LogResponse toResponse(Map<String, Object> row) {
        return new LogResponse(
                asLong(row.get("id")),
                asLong(row.get("task_id")),
                asLocalDate(row.get("log_date")),
                asString(row.get("phase")),
                asInt(row.get("ordinal")),
                asString(row.get("content")),
                asString(row.get("polished_content")),
                asBool(row.get("is_deleted")),
                asInstant(row.get("deleted_at")),
                asInstant(row.get("updated_at")),
                asInt(row.get("edit_count")),
                asInstant(row.get("created_at"))
        );
    }

    private static Long asLong(Object o) { return o == null ? null : ((Number) o).longValue(); }
    private static Integer asInt(Object o) { return o == null ? null : ((Number) o).intValue(); }
    private static Boolean asBool(Object o) {
        if (o == null) return Boolean.FALSE;
        // SQLite 用 INTEGER 存 bool（0/1），Xerial 返回 Integer
        if (o instanceof Number n) return n.intValue() != 0;
        if (o instanceof Boolean b) return b;
        return "1".equals(o.toString()) || "true".equalsIgnoreCase(o.toString());
    }
    private static String asString(Object o) { return o == null ? null : o.toString(); }
    private static LocalDate asLocalDate(Object o) {
        if (o == null) return null;
        if (o instanceof java.sql.Date d) return d.toLocalDate();
        if (o instanceof LocalDate ld) return ld;
        String s = o.toString();
        try { return LocalDate.parse(s); }
        catch (DateTimeParseException ignored) {}
        try { return LocalDate.parse(s.length() >= 10 ? s.substring(0, 10) : s); }
        catch (DateTimeParseException ignored) {}
        return null;
    }
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
