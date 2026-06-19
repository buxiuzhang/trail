package com.trail.web.controller;

import com.trail.web.ws.WatchAlertScheduler;
import com.trail.web.ws.WatchAlertSseService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;

@RestController
@RequestMapping("/api/watch-alerts")
public class WatchAlertController {

    private final WatchAlertSseService sseService;
    private final WatchAlertScheduler scheduler;

    public WatchAlertController(WatchAlertSseService sseService, WatchAlertScheduler scheduler) {
        this.sseService = sseService;
        this.scheduler = scheduler;
    }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream() {
        return sseService.subscribe();
    }

    @PostMapping("/trigger")
    public Map<String, Object> trigger() {
        scheduler.check();
        return Map.of("ok", true);
    }
}
