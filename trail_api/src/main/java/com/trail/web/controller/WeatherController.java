package com.trail.web.controller;

import com.trail.service.QWeatherService;
import com.trail.store.LLMSettingsStore;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/weather")
@Tag(name = "天气", description = "实时天气查询（代理和风天气 API）")
public class WeatherController {

    private final QWeatherService qWeather;
    private final LLMSettingsStore store;

    public WeatherController(QWeatherService qWeather, LLMSettingsStore store) {
        this.qWeather = qWeather;
        this.store = store;
    }

    @Operation(summary = "获取实时天气", description = "location 可传 lat,lon 或城市名；留空则用默认城市；凭据未配置返回 204")
    @GetMapping
    public ResponseEntity<?> get(@RequestParam(required = false) String location) {
        String loc = location;
        if (loc == null || loc.isBlank()) {
            loc = store.get("weather_default_city");
        }
        if (loc == null || loc.isBlank()) {
            return ResponseEntity.noContent().build();
        }

        QWeatherService.WeatherNow now = qWeather.getWeather(loc);
        if (now == null) {
            return ResponseEntity.noContent().build();
        }

        return ResponseEntity.ok(Map.of(
            "icon",         now.icon(),
            "text",         now.text(),
            "temp",         now.temp(),
            "feelsLike",    now.feelsLike(),
            "humidity",     now.humidity(),
            "windDir",      now.windDir(),
            "windScale",    now.windScale(),
            "obsTime",      now.obsTime(),
            "districtName", now.districtName()
        ));
    }
}
