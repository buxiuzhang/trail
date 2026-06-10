package com.trail.web.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;

/** Map<String,Object>（store 行） + List<ContactDto>（contacts 行） → TaskResponse。 */
public final class TaskMapper {

    private TaskMapper() {}

    public static TaskResponse toResponse(Map<String, Object> row, List<ContactDto> contacts) {
        return new TaskResponse(
                asLong(row.get("id")),
                asString(row.get("title")),
                asString(row.get("alias")),
                asString(row.get("description")),
                asLocalDate(row.get("start_date")),
                asLocalDate(row.get("processing_date")),
                asLocalDate(row.get("end_date")),
                asString(row.get("status")),
                asString(row.get("nature")),
                asString(row.get("summary")),
                asString(row.get("maintenance_summary")),
                asStringList(row.get("tags")),
                asString(row.get("original_title")),
                asString(row.get("source")),
                asInstant(row.get("pinned_at")),
                asInstant(row.get("created_at")),
                asInstant(row.get("updated_at")),
                asLocalDate(row.get("last_log_date")),
                contacts == null ? List.of() : contacts
        );
    }

    /** contacts 行（Map）→ ContactDto。 */
    public static ContactDto contactToDto(Map<String, Object> row) {
        return new ContactDto(
                asLong(row.get("id")),
                asString(row.get("name")),
                asString(row.get("kind")),
                asString(row.get("channel")),
                asString(row.get("target")),
                asString(row.get("note")),
                asInstant(row.get("created_at")) == null ? null
                        : asInstant(row.get("created_at")).toString()
        );
    }

    private static Long asLong(Object o) { return o == null ? null : ((Number) o).longValue(); }
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
        // 多种形态（与 JdbcTypes.parseOffsetDateTime 对齐）：
        //   1) ISO_OFFSET_DATE_TIME（带 T + ±HH:MM）
        //   2) LocalDateTime（带 T 无时区）→ 视作 UTC
        //   3) 空格分隔无时区（CURRENT_TIMESTAMP 默认）→ 视作 UTC
        //   4) UTC 'Z' 后缀
        try { return OffsetDateTime.parse(s).toInstant(); }
        catch (DateTimeParseException ignored) {}
        // 关键：先替换空格为 T，再走 LocalDateTime（不需要 offset）
        String t = s.indexOf(' ') >= 0 ? s.replace(' ', 'T') : s;
        try { return LocalDateTime.parse(t).toInstant(ZoneOffset.UTC); }
        catch (DateTimeParseException ignored) {}
        try { return Instant.parse(t); }
        catch (DateTimeParseException ignored) {}
        return null;
    }
    private static List<String> asStringList(Object o) {
        if (o == null) return List.of();
        if (o instanceof List<?> l) return l.stream().map(String::valueOf).toList();
        if (o instanceof String[] arr) return List.of(arr);
        if (o instanceof String s) return parseJsonStringArray(s);
        return List.of();
    }

    /**
     * 极简 JSON 字符串数组解析：只认 {@code ["a","b"]} 形态。store 层 JSON 序列化保证格式固定，
     * 因此手写解析足够，不必引 Jackson 依赖（避免与全局 ObjectMapper 配置相互耦合）。
     */
    static List<String> parseJsonStringArray(String s) {
        if (s == null) return List.of();
        String t = s.trim();
        if (t.isEmpty() || "[]".equals(t)) return List.of();
        if (t.charAt(0) != '[' || t.charAt(t.length() - 1) != ']') return List.of();
        String inner = t.substring(1, t.length() - 1).trim();
        if (inner.isEmpty()) return List.of();
        java.util.List<String> out = new java.util.ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inStr = false;
        boolean esc = false;
        for (int i = 0; i < inner.length(); i++) {
            char c = inner.charAt(i);
            if (esc) { cur.append(c); esc = false; continue; }
            if (c == '\\') { esc = true; continue; }
            if (c == '"') { inStr = !inStr; continue; }
            if (c == ',' && !inStr) { out.add(cur.toString()); cur.setLength(0); continue; }
            cur.append(c);
        }
        if (cur.length() > 0) out.add(cur.toString());
        return out;
    }
}
