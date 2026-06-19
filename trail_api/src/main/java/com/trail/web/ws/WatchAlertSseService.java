package com.trail.web.ws;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.concurrent.CopyOnWriteArraySet;

/** 维护所有 SSE 客户端，支持广播。 */
@Component
public class WatchAlertSseService {

    private static final Logger log = LoggerFactory.getLogger(WatchAlertSseService.class);
    private final CopyOnWriteArraySet<SseEmitter> emitters = new CopyOnWriteArraySet<>();

    /** 创建并注册一个新的 SseEmitter（30 分钟超时，客户端会自动重连）。 */
    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(5 * 60 * 1000L);
        emitters.add(emitter);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> emitters.remove(emitter));
        emitter.onError(e -> emitters.remove(emitter));
        log.debug("SSE subscribed, total={}", emitters.size());
        return emitter;
    }

    /** 广播 JSON 字符串到所有在线客户端。 */
    public void broadcast(String json) {
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().name("watch_alert").data(json));
            } catch (IOException e) {
                emitters.remove(emitter);
            }
        }
    }

    public boolean hasClients() {
        return !emitters.isEmpty();
    }
}
