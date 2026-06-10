package com.trail.db;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * JDBC 类型工具 · SQLite 版（M8）。
 *
 * SQLite 行为：
 *   - DATE / TIMESTAMP 都用 TEXT（ISO 8601 字符串）
 *   - BOOLEAN 用 INTEGER（0/1）
 *   - 不支持数组（tags 用 JSON 字符串，store 层做 JSON 转换）
 *   - 没有 LocalDate/Instant 直接映射——ResultSet.getObject 拿 String
 *
 * 因此 getValue / rowToMap 把所有"时间"统一解析成 LocalDate / OffsetDateTime。
 */
public final class JdbcTypes {

    private JdbcTypes() {}

    public static void setParam(PreparedStatement ps, int idx, Object value) throws SQLException {
        if (value == null) {
            ps.setObject(idx, null);
            return;
        }
        if (value instanceof LocalDate ld) {
            ps.setString(idx, ld.toString());           // "YYYY-MM-DD"
        } else if (value instanceof OffsetDateTime odt) {
            ps.setString(idx, odt.toString());          // ISO 8601 with offset
        } else if (value instanceof java.time.Instant inst) {
            ps.setString(idx, inst.toString());
        } else if (value instanceof String[] arr) {
            // tags 等 JSON 字符串：store 层已 JSON.stringify，这里当作字符串进
            ps.setString(idx, arr.length == 0 ? "[]" : jsonArrayOf(arr));
        } else if (value instanceof java.util.List<?> list) {
            String[] arr = list.stream().map(String::valueOf).toArray(String[]::new);
            ps.setString(idx, arr.length == 0 ? "[]" : jsonArrayOf(arr));
        } else if (value instanceof Long l) {
            ps.setLong(idx, l);
        } else if (value instanceof Integer n) {
            ps.setInt(idx, n);
        } else if (value instanceof Boolean b) {
            ps.setInt(idx, b ? 1 : 0);
        } else {
            ps.setString(idx, value.toString());
        }
    }

    public static Object getValue(ResultSet rs, int col, int sqlType) throws SQLException {
        Object raw = rs.getObject(col);
        if (rs.wasNull() || raw == null) return null;
        // SQLite 一律给 String / Long / Double / byte[]，做时间解析
        if (raw instanceof String s) {
            if (sqlType == Types.DATE) {
                return parseLocalDate(s);
            }
            if (sqlType == Types.TIMESTAMP || sqlType == Types.TIMESTAMP_WITH_TIMEZONE) {
                return parseOffsetDateTime(s);
            }
            return s;
        }
        return raw;
    }

    /** DATE → LocalDate：认 "YYYY-MM-DD"；其他形态（带时间等）截前 10 位再试。 */
    private static LocalDate parseLocalDate(String s) {
        if (s == null || s.isEmpty()) return null;
        try { return LocalDate.parse(s); }
        catch (DateTimeParseException ignored) {}
        try { return LocalDate.parse(s.length() >= 10 ? s.substring(0, 10) : s, DateTimeFormatter.ISO_LOCAL_DATE); }
        catch (DateTimeParseException ignored) {}
        return null;
    }

    /** TIMESTAMP → OffsetDateTime：认三种形态
     *  1) ISO_OFFSET_DATE_TIME（带 T + ±HH:MM，如 2026-06-09T16:59:18+08:00）
     *  2) ISO_LOCAL_DATE_TIME（带 T 无时区，如 2026-06-09T16:59:18）→ 当作 UTC
     *  3) 空格分隔无时区（CURRENT_TIMESTAMP 默认形态，2026-06-09 16:59:18）→ 当作 UTC
     *  4) UTC 'Z' 后缀（如 2026-06-09T16:59:18Z）走 Instant.parse
     *  解析失败返 null（不抛，避免 500）。 */
    private static OffsetDateTime parseOffsetDateTime(String s) {
        if (s == null || s.isEmpty()) return null;
        try { return OffsetDateTime.parse(s); }
        catch (DateTimeParseException ignored) {}
        // 关键：先把空格换成 T，再走 LocalDateTime（不需要 offset）
        String t = s.indexOf(' ') >= 0 ? s.replace(' ', 'T') : s;
        try {
            LocalDateTime ldt = LocalDateTime.parse(t);
            return ldt.atOffset(ZoneOffset.UTC);
        } catch (DateTimeParseException ignored) {}
        try { return Instant.parse(t).atOffset(ZoneOffset.UTC); }
        catch (DateTimeParseException ignored) {}
        return null;
    }

    public static Map<String, Object> rowToMap(ResultSet rs) throws SQLException {
        var meta = rs.getMetaData();
        int n = meta.getColumnCount();
        LinkedHashMap<String, Object> out = new LinkedHashMap<>();
        for (int i = 1; i <= n; i++) {
            String name = meta.getColumnLabel(i);
            int type = meta.getColumnType(i);
            out.put(name, getValue(rs, i, type));
        }
        return out;
    }

    private static String jsonArrayOf(String[] arr) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < arr.length; i++) {
            if (i > 0) sb.append(",");
            sb.append("\"").append(arr[i].replace("\\", "\\\\").replace("\"", "\\\"")).append("\"");
        }
        return sb.append("]").toString();
    }
}
