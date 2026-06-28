package com.trail.service;

import com.trail.db.SqliteDb;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 启动时将和风天气 CSV 城市/POI 列表导入本地 SQLite。
 * 幂等：qw_cities 非空则跳过全部导入。
 */
@Component
public class QWeatherCsvImporter {

    private static final Logger log = LoggerFactory.getLogger(QWeatherCsvImporter.class);

    private final SqliteDb db;

    public QWeatherCsvImporter(SqliteDb db) {
        this.db = db;
    }

    public void importAll() {
        try {
            List<Map<String, Object>> countRows = db.query("SELECT COUNT(*) AS n FROM qw_cities");
            long count = countRows.isEmpty() ? 0 : ((Number) countRows.get(0).get("n")).longValue();
            if (count > 0) {
                log.debug("qw_cities 已有 {} 条，跳过 CSV 导入", count);
                return;
            }
        } catch (Exception e) {
            log.warn("检查 qw_cities 失败，跳过导入: {}", e.getMessage());
            return;
        }

        log.info("开始导入和风天气城市/POI 数据…");
        importCities();
        importAir();
        importScenic();
        importTide();
        log.info("和风天气数据导入完成");
    }

    private void importCities() {
        // 列顺序: Location_ID(0), Name_EN(1), Name_ZH(2), ISO(3), Country_EN(4), Country_ZH(5),
        //         Adm1_EN(6), Adm1_ZH(7), Adm2_EN(8), Adm2_ZH(9), Timezone(10), Latitude(11), Longitude(12), AD_code(13)
        String sql = """
            INSERT OR IGNORE INTO qw_cities
              (location_id, name_zh, name_en, adm1_zh, adm2_zh, latitude, longitude, country_code)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """;
        int imported = batchInsert("qweather/China-City-List-latest.csv", sql, row -> {
            if (row.length < 13) return null;
            return new Object[]{
                row[0].trim(),   // location_id
                row[2].trim(),   // name_zh
                row[1].trim(),   // name_en
                row[7].trim(),   // adm1_zh
                row[9].trim(),   // adm2_zh
                parseDouble(row[11]),  // latitude
                parseDouble(row[12]),  // longitude
                row[3].trim()    // country_code
            };
        });
        log.info("qw_cities 导入 {} 条", imported);
    }

    private void importAir() {
        // 列顺序: POI_ID(0), POI_Longitude(1), POI_Latitude(2), POI_Name(3), POI_Type(4),
        //         Location_ID(5), Location_Name_ZH(6), Location_Name_EN(7), Adm2_ZH(8), Adm2_EN(9), Adm1_ZH(10), Adm1_EN(11)
        String sql = """
            INSERT OR IGNORE INTO qw_poi_air
              (poi_id, poi_name, poi_type, location_id, adm1_zh, adm2_zh, latitude, longitude)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """;
        int imported = batchInsert("qweather/POI-Air-Monitoring-Station-List-latest.csv", sql, row -> {
            if (row.length < 11) return null;
            return new Object[]{
                row[0].trim(),
                row[3].trim(),
                row[4].trim(),
                row[5].trim(),
                row[10].trim(),
                row[8].trim(),
                parseDouble(row[2]),
                parseDouble(row[1])
            };
        });
        log.info("qw_poi_air 导入 {} 条", imported);
    }

    private void importScenic() {
        // 列顺序: POI_ID(0), POI_Name_EN(1), POI_Name_ZH(2), POI_Latitude(3), POI_Longitude(4),
        //         Country_code(5), Country_EN(6), Country_ZH(7), Location_ID(8), Adm1_EN(9), Adm1_ZH(10), Adm2_EN(11), Adm2_ZH(12)
        String sql = """
            INSERT OR IGNORE INTO qw_poi_scenic
              (poi_id, poi_name_zh, poi_name_en, location_id, adm1_zh, adm2_zh, latitude, longitude)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """;
        int imported = batchInsert("qweather/POI-Scenic-List-latest.csv", sql, row -> {
            if (row.length < 11) return null;
            return new Object[]{
                row[0].trim(),
                row[2].trim(),
                row[1].trim(),
                row.length > 8 ? row[8].trim() : "",
                row.length > 10 ? row[10].trim() : "",
                row.length > 12 ? row[12].trim() : "",
                parseDouble(row[3]),
                parseDouble(row[4])
            };
        });
        log.info("qw_poi_scenic 导入 {} 条", imported);
    }

    private void importTide() {
        // 列顺序: POI_ID(0), POI_Name_Local(1), POI_Name_EN(2), POI_Name_ZH(3),
        //         POI_Latitude(4), POI_Longitude(5), POI_Type(6), ISO(7)
        String sql = """
            INSERT OR IGNORE INTO qw_poi_tide
              (poi_id, poi_name_local, poi_name_en, poi_name_zh, latitude, longitude, poi_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """;
        int imported = batchInsert("qweather/POI-Tide-Station-List-latest.csv", sql, row -> {
            if (row.length < 7) return null;
            return new Object[]{
                row[0].trim(),
                row[1].trim(),
                row[2].trim(),
                row[3].trim(),
                parseDouble(row[4]),
                parseDouble(row[5]),
                row[6].trim()
            };
        });
        log.info("qw_poi_tide 导入 {} 条", imported);
    }

    @FunctionalInterface
    private interface RowMapper {
        Object[] map(String[] row);
    }

    private int batchInsert(String classpath, String sql, RowMapper mapper) {
        List<Object[]> batch = new ArrayList<>();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(
                new ClassPathResource(classpath).getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            int lineNo = 0;
            while ((line = br.readLine()) != null) {
                lineNo++;
                if (lineNo <= 2) continue; // 跳过版本注释行和表头行
                String[] cols = parseCsvLine(line);
                Object[] params = mapper.map(cols);
                if (params != null) batch.add(params);
            }
        } catch (Exception e) {
            log.warn("读取 {} 失败: {}", classpath, e.getMessage());
            return 0;
        }

        if (batch.isEmpty()) return 0;

        return db.runInTransaction(conn -> {
            int count = 0;
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                for (Object[] params : batch) {
                    for (int i = 0; i < params.length; i++) {
                        if (params[i] == null) {
                            ps.setNull(i + 1, java.sql.Types.NULL);
                        } else if (params[i] instanceof Double d) {
                            ps.setDouble(i + 1, d);
                        } else {
                            ps.setString(i + 1, params[i].toString());
                        }
                    }
                    ps.addBatch();
                    count++;
                    if (count % 500 == 0) ps.executeBatch();
                }
                ps.executeBatch();
            } catch (Exception e) {
                throw new RuntimeException("批量导入失败: " + e.getMessage(), e);
            }
            return count;
        });
    }

    private Double parseDouble(String s) {
        if (s == null || s.isBlank()) return null;
        try { return Double.parseDouble(s.trim()); }
        catch (NumberFormatException e) { return null; }
    }

    /** 简单 CSV 解析，处理双引号包裹的字段 */
    private String[] parseCsvLine(String line) {
        List<String> fields = new ArrayList<>();
        boolean inQuote = false;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                inQuote = !inQuote;
            } else if (c == ',' && !inQuote) {
                fields.add(sb.toString());
                sb.setLength(0);
            } else {
                sb.append(c);
            }
        }
        fields.add(sb.toString());
        return fields.toArray(new String[0]);
    }
}
