package com.trail.web.error;

import com.trail.store.exception.DataDirNotConfiguredException;
import com.trail.store.exception.DuplicateException;
import com.trail.store.exception.InvalidTransitionException;
import com.trail.store.exception.LlmApiException;
import com.trail.store.exception.LlmNotConfiguredException;
import com.trail.store.exception.NotFoundException;
import com.trail.store.exception.StoreError;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;

@ControllerAdvice
public class GlobalExceptionHandler {

    private static ResponseEntity<Map<String, Object>> of(HttpStatus status, String msg) {
        return ResponseEntity.status(status).body(Map.of("detail", msg));
    }

    /** M8：数据目录未配置 → 503 + code:NEEDS_DATA_DIR（前端路由拦截依赖） */
    @ExceptionHandler(DataDirNotConfiguredException.class)
    public ResponseEntity<Map<String, Object>> dataDir(DataDirNotConfiguredException e) {
        Map<String, Object> body = new HashMap<>();
        body.put("code", "NEEDS_DATA_DIR");
        body.put("detail", e.getMessage());
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(body);
    }

    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<Map<String, Object>> notFound(NotFoundException e) {
        return of(HttpStatus.NOT_FOUND, e.getMessage());
    }

    @ExceptionHandler(DuplicateException.class)
    public ResponseEntity<Map<String, Object>> duplicate(DuplicateException e) {
        return of(HttpStatus.CONFLICT, e.getMessage());
    }

    @ExceptionHandler(InvalidTransitionException.class)
    public ResponseEntity<Map<String, Object>> invalidTransition(InvalidTransitionException e) {
        return of(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(StoreError.class)
    public ResponseEntity<Map<String, Object>> store(StoreError e) {
        return of(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    /** LLM 未配置 → 503 */
    @ExceptionHandler(LlmNotConfiguredException.class)
    public ResponseEntity<Map<String, Object>> llmNotConfigured(LlmNotConfiguredException e) {
        return of(HttpStatus.SERVICE_UNAVAILABLE, e.getMessage());
    }

    /** LLM API 调用失败 → 502 */
    @ExceptionHandler(LlmApiException.class)
    public ResponseEntity<Map<String, Object>> llmApi(LlmApiException e) {
        return of(HttpStatus.BAD_GATEWAY, e.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> illegalArgument(IllegalArgumentException e) {
        return of(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    /** SQLite 锁错误（busy / locked）→ 503 */
    @ExceptionHandler(java.sql.SQLException.class)
    public ResponseEntity<Map<String, Object>> sql(java.sql.SQLException e) {
        String msg = e.getMessage() == null ? "" : e.getMessage();
        if (msg.contains("database is locked") || msg.contains("SQLITE_BUSY")) {
            return of(HttpStatus.SERVICE_UNAVAILABLE, "数据库被其他进程占用（持写锁）。请断开连接后重试。");
        }
        org.slf4j.LoggerFactory.getLogger(GlobalExceptionHandler.class)
                .error("SQLException: {}", msg, e);
        return of(HttpStatus.INTERNAL_SERVER_ERROR, "数据库操作失败，请稍后重试。");
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> illegalState(IllegalStateException e) {
        org.slf4j.LoggerFactory.getLogger(GlobalExceptionHandler.class)
                .error("IllegalStateException: {}", e.getMessage(), e);
        return of(HttpStatus.INTERNAL_SERVER_ERROR, "服务内部状态异常，请稍后重试。");
    }

    /**
     * Spring 6 资源 handler 对空 resource path（"GET /"）直接抛 NoResourceFoundException。
     * 非 /api/* 路径 → 返 index.html（SPA fallback）；/api/* 路径 → 404。
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<?> noStaticResource(NoResourceFoundException e, jakarta.servlet.http.HttpServletRequest req) {
        String uri = req.getRequestURI();
        if (uri != null && uri.startsWith("/api/")) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("detail", "接口不存在：" + uri));
        }
        Resource index = findIndexHtml();
        if (index == null || !index.exists()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("detail", "前端 dist 未构建或路径错误"));
        }
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .body(index);
    }

    private static Resource findIndexHtml() {
        String env = System.getenv("TRAIL_FRONTEND_DIR");
        String dir = (env != null && !env.isBlank()) ? env : "../trail_web/dist";
        Path p = Paths.get(dir);
        if (!p.isAbsolute()) p = p.toAbsolutePath();
        Path idx = p.resolve("index.html");
        return Files.exists(idx) ? new FileSystemResource(idx) : null;
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> responseStatus(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode())
                .body(Map.of("detail", e.getReason() == null ? e.getMessage() : e.getReason()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> fallback(Exception e) {
        org.slf4j.LoggerFactory.getLogger(GlobalExceptionHandler.class)
                .error("未处理异常: {}", e.getClass().getName(), e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("detail", "服务内部错误，请稍后重试。"));
    }
}
