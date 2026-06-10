package com.trail.store;

import com.trail.db.SqliteDb;
import com.trail.store.exception.StoreError;
import org.springframework.stereotype.Component;

import java.util.Set;

/** ai_records append-only 写入。 */
@Component
public class AiRecordStore {

    public static final Set<String> OPS = Set.of("polish", "summarize", "ask_maintenance", "chat", "chat_tool_use");

    private final SqliteDb db;

    public AiRecordStore(SqliteDb db) {
        this.db = db;
    }

    public long addRecord(Long taskId, Long logId, String op, String prompt, String response, boolean userConfirmed) {
        if (op == null || !OPS.contains(op)) throw new StoreError("非法 op：" + op);
        Long id = db.insertReturningId(
            "INSERT INTO ai_records (task_id, log_id, op, prompt, response, user_confirmed)"
          + " VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
            taskId, logId, op, prompt, response, userConfirmed ? 1 : 0);
        if (id == null) throw new StoreError("ai_record 写入失败");
        return id;
    }

    public void confirmRecord(long recordId) {
        db.update("UPDATE ai_records SET user_confirmed = 1 WHERE id = ?", recordId);
    }
}
