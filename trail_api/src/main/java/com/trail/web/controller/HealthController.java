package com.trail.web.controller;

import com.trail.db.SqliteDb;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@Tag(name = "健康检查", description = "服务状态检测")
public class HealthController {

    private final SqliteDb db;

    public HealthController(SqliteDb db) {
        this.db = db;
    }

    @Operation(summary = "健康检查", description = "检测服务是否正常运行")
    @GetMapping("/api/health")
    public Map<String, Object> health() {
        return Map.of("ok", true, "version", "0.3.0");
    }

    @Operation(summary = "重建 FTS5 全文索引", description = "手动触发 fts_tasks / fts_logs 全量重建，任务信息变更后可调用")
    @PostMapping("/api/admin/fts/rebuild")
    public Map<String, Object> rebuildFts() {
        db.update("INSERT INTO fts_tasks(fts_tasks) VALUES('delete-all')");
        db.update("INSERT INTO fts_tasks(rowid, title, description) SELECT id, title, description FROM tasks");
        db.update("INSERT INTO fts_logs(fts_logs) VALUES('delete-all')");
        db.update("INSERT INTO fts_logs(rowid, content, polished_content) SELECT id, content, polished_content FROM work_logs WHERE is_deleted = 0");
        long taskCount = (long) db.query("SELECT COUNT(*) AS n FROM tasks").get(0).get("n");
        long logCount  = (long) db.query("SELECT COUNT(*) AS n FROM work_logs WHERE is_deleted = 0").get(0).get("n");
        return Map.of("ok", true, "tasks_indexed", taskCount, "logs_indexed", logCount);
    }
}
