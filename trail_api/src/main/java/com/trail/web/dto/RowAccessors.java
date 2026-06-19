package com.trail.web.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;

/**
 * Mapper 公共工具：SQLite 行数据类型转换。
 * 三个 Mapper（Task/Log/Todo）各自的私有 as* 方法完全一致，统一放这里。
 */
public final class RowAccessors {
    private RowAccessors() {}

    public static Long asLong(Object o) {
        return o == null ? null : ((Number) o).longValue();
    }

    public static Integer asInt(Object o) {
        return o == null ? null : ((Number) o).intValue();
    }

    /** null 时返回 0，用于 int 基本类型字段（不接受 null）。 */
    public static int asIntOrZero(Object o) {
        return o == null ? 0 : ((Number) o).intValue();
    }

    public static Double asDouble(Object o) {
        return o == null ? null : ((Number) o).doubleValue();
    }

    public static Boolean asBool(Object o) {
        if (o == null) return Boolean.FALSE;
        if (o instanceof Number n) return n.intValue() != 0;
        if (o instanceof Boolean b) return b;
        return "1".equals(o.toString()) || "true".equalsIgnoreCase(o.toString());
    }

    public static String asString(Object o) {
        return o == null ? null : o.toString();
    }

    public static LocalDate asLocalDate(Object o) {
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

    public static Instant asInstant(Object o) {
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
