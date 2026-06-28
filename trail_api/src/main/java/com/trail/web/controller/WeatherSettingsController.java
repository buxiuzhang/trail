package com.trail.web.controller;

import com.trail.db.SqliteDb;
import com.trail.service.QWeatherService;
import com.trail.store.LLMSettingsStore;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/settings/weather")
@Tag(name = "天气配置", description = "和风天气 API 凭据配置")
public class WeatherSettingsController {

    private final LLMSettingsStore store;
    private final QWeatherService qWeather;
    private final SqliteDb db;

    public WeatherSettingsController(LLMSettingsStore store, QWeatherService qWeather, SqliteDb db) {
        this.store = store;
        this.qWeather = qWeather;
        this.db = db;
    }

    @Operation(summary = "获取天气配置")
    @GetMapping
    public Map<String, String> get() {
        String pk = store.get("weather_private_key");
        String masked = (pk != null && !pk.isBlank()) ? "****" : "";
        String defaultCity = orEmpty(store.get("weather_default_city"));
        String defaultCityName = defaultCity.isEmpty() ? "" : qWeather.lookupCityName(defaultCity);

        Map<String, String> result = new HashMap<>();
        result.put("project_id",         orEmpty(store.get("weather_project_id")));
        result.put("credential_id",       orEmpty(store.get("weather_credential_id")));
        result.put("api_host",            orEmpty(store.get("weather_api_host")));
        result.put("private_key_masked",  masked);
        result.put("default_city",        defaultCity);
        result.put("default_city_name",   defaultCityName);
        return result;
    }

    @Operation(summary = "保存天气配置")
    @PutMapping
    public Map<String, Object> save(@RequestBody Map<String, String> data) {
        saveIfPresent(data, "project_id",    "weather_project_id");
        saveIfPresent(data, "credential_id", "weather_credential_id");
        saveIfPresent(data, "api_host",      "weather_api_host");
        saveIfPresent(data, "private_key",   "weather_private_key");
        if (data.containsKey("location_id")) {
            saveIfPresent(data, "location_id", "weather_default_city");
            qWeather.clearWeatherCache();
        } else {
            saveIfPresent(data, "default_city", "weather_default_city");
        }
        return Map.of("ok", true);
    }

    @Operation(summary = "获取省份列表")
    @GetMapping("/cities/provinces")
    public List<String> provinces() {
        return db.query(
            "SELECT DISTINCT adm1_zh FROM qw_cities WHERE country_code = 'CN' AND adm1_zh != '' ORDER BY adm1_zh"
        ).stream().map(r -> (String) r.get("adm1_zh")).collect(Collectors.toList());
    }

    @Operation(summary = "获取省内城市列表")
    @GetMapping("/cities/adm2")
    public List<String> adm2(@RequestParam String province) {
        return db.query(
            "SELECT DISTINCT adm2_zh FROM qw_cities WHERE adm1_zh = ? AND adm2_zh != '' ORDER BY adm2_zh", province
        ).stream().map(r -> (String) r.get("adm2_zh")).collect(Collectors.toList());
    }

    @Operation(summary = "获取市内区县列表")
    @GetMapping("/cities/districts")
    public List<Map<String, String>> districts(@RequestParam String province, @RequestParam String city) {
        return db.query(
            "SELECT location_id, name_zh FROM qw_cities WHERE adm1_zh = ? AND adm2_zh = ? ORDER BY name_zh",
            province, city
        ).stream().map(r -> Map.of(
            "location_id", (String) r.get("location_id"),
            "name_zh",     (String) r.get("name_zh")
        )).collect(Collectors.toList());
    }

    @Operation(summary = "根据 location_id 或城市名反查省市区")
    @GetMapping("/cities/lookup")
    public Map<String, String> lookup(@RequestParam String locationId) {
        List<Map<String, Object>> rows = db.query(
            "SELECT location_id, name_zh, adm1_zh, adm2_zh FROM qw_cities WHERE location_id = ?", locationId);
        boolean needsMigration = false;
        // 兼容旧版：若按 ID 查不到，依次尝试多种名称匹配
        if (rows.isEmpty()) {
            // 1. name_zh 精确匹配
            rows = db.query(
                "SELECT location_id, name_zh, adm1_zh, adm2_zh FROM qw_cities WHERE name_zh = ? LIMIT 1", locationId);
            needsMigration = !rows.isEmpty();
        }
        if (rows.isEmpty()) {
            // 2. adm2_zh 精确匹配（如存的是"广州市"，是市级名称）
            rows = db.query(
                "SELECT location_id, name_zh, adm1_zh, adm2_zh FROM qw_cities WHERE adm2_zh = ? ORDER BY name_zh LIMIT 1", locationId);
            needsMigration = !rows.isEmpty();
        }
        if (rows.isEmpty()) {
            // 3. 去掉末尾"市/区/县"后 name_zh 精确匹配
            String stripped = locationId.replaceAll("[市区县]$", "");
            if (!stripped.equals(locationId)) {
                rows = db.query(
                    "SELECT location_id, name_zh, adm1_zh, adm2_zh FROM qw_cities WHERE name_zh = ? LIMIT 1", stripped);
                needsMigration = !rows.isEmpty();
            }
        }
        if (rows.isEmpty()) {
            // 4. name_zh LIKE 前缀匹配
            rows = db.query(
                "SELECT location_id, name_zh, adm1_zh, adm2_zh FROM qw_cities WHERE name_zh LIKE ? LIMIT 1",
                locationId + "%");
            needsMigration = !rows.isEmpty();
        }
        if (rows.isEmpty()) return Map.of();
        Map<String, Object> row = rows.get(0);
        String canonicalId = orEmpty((String) row.get("location_id"));
        // 自动迁移旧城市名 → location_id
        if (needsMigration && !canonicalId.isEmpty()) {
            store.save("weather_default_city", canonicalId);
        }
        return Map.of(
            "location_id", canonicalId,
            "name_zh",     orEmpty((String) row.get("name_zh")),
            "adm1_zh",     orEmpty((String) row.get("adm1_zh")),
            "adm2_zh",     orEmpty((String) row.get("adm2_zh"))
        );
    }

    private void saveIfPresent(Map<String, String> data, String field, String storeKey) {
        if (!data.containsKey(field)) return;
        String v = data.get(field);
        if (v == null || v.isBlank()) store.delete(storeKey);
        else store.save(storeKey, v);
    }

    private String orEmpty(String s) {
        return s == null ? "" : s;
    }
}
