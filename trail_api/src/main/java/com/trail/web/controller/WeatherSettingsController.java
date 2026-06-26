package com.trail.web.controller;

import com.trail.service.QWeatherService;
import com.trail.store.LLMSettingsStore;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/settings/weather")
@Tag(name = "天气配置", description = "和风天气 API 凭据配置")
public class WeatherSettingsController {

    private final LLMSettingsStore store;
    private final QWeatherService qWeather;

    public WeatherSettingsController(LLMSettingsStore store, QWeatherService qWeather) {
        this.store = store;
        this.qWeather = qWeather;
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
        saveIfPresent(data, "default_city",  "weather_default_city");
        return Map.of("ok", true);
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
