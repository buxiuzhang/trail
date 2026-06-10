package com.trail.store;

import com.trail.db.SqliteDb;
import com.trail.store.exception.NotFoundException;
import com.trail.store.exception.StoreError;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 对接渠道子表 CRUD。整组替换走事务 BEGIN/DELETE/INSERT/COMMIT。 */
@Component
public class ContactStore {

    public static final Set<String> KINDS = Set.of("group", "person", "email", "phone", "other");
    public static final Set<String> CHANNELS = Set.of("dingtalk", "wechat", "elink", "lark", "feishu", "email", "phone", "other");

    private final SqliteDb db;

    public ContactStore(SqliteDb db) {
        this.db = db;
    }

    public List<Map<String, Object>> listContacts(long taskId) {
        return db.query(
            "SELECT id, task_id, kind, channel, name, target, note, created_at"
          + " FROM contact_channels WHERE task_id = ? ORDER BY id",
            taskId);
    }

    public Map<Long, List<Map<String, Object>>> listContactsBulk(List<Long> taskIds) {
        if (taskIds == null || taskIds.isEmpty()) return Map.of();
        StringBuilder sql = new StringBuilder(
            "SELECT id, task_id, kind, channel, name, target, note, created_at"
          + " FROM contact_channels WHERE task_id IN (");
        for (int i = 0; i < taskIds.size(); i++) sql.append(i == 0 ? "?" : ",?");
        sql.append(") ORDER BY task_id, id");

        List<Map<String, Object>> rows = db.query(sql.toString(), taskIds.toArray());
        Map<Long, List<Map<String, Object>>> grouped = new HashMap<>();
        for (Long tid : taskIds) grouped.put(tid, new ArrayList<>());
        for (Map<String, Object> r : rows) {
            Long tid = ((Number) r.get("task_id")).longValue();
            grouped.get(tid).add(r);
        }
        return grouped;
    }

    public List<Map<String, Object>> setContacts(long taskId, List<Map<String, Object>> contacts) {
        // 1) 校验
        for (Map<String, Object> c : contacts) {
            String kind = (String) c.get("kind");
            String channel = (String) c.get("channel");
            String name = c.get("name") == null ? "" : ((String) c.get("name")).trim();
            if (kind == null || !KINDS.contains(kind))
                throw new StoreError("非法 kind：" + kind);
            if (channel == null || !CHANNELS.contains(channel))
                throw new StoreError("非法 channel：" + channel);
            if (name.isEmpty()) throw new StoreError("name 不能为空");
            c.put("name", name);
            c.putIfAbsent("target", null);
            c.putIfAbsent("note", null);
        }

        // 2) 事务
        return db.runInTransaction(con -> {
            try {
                try (var ps = con.prepareStatement("SELECT 1 FROM tasks WHERE id = ?")) {
                    ps.setObject(1, taskId);
                    try (var rs = ps.executeQuery()) {
                        if (!rs.next()) throw new NotFoundException("任务不存在：" + taskId);
                    }
                }
                try (var ps = con.prepareStatement("DELETE FROM contact_channels WHERE task_id = ?")) {
                    ps.setObject(1, taskId);
                    ps.executeUpdate();
                }
                try (var ps = con.prepareStatement(
                    "INSERT INTO contact_channels (task_id, kind, channel, name, target, note)"
                  + " VALUES (?, ?, ?, ?, ?, ?)")) {
                    for (Map<String, Object> c : contacts) {
                        ps.setObject(1, taskId);
                        ps.setObject(2, c.get("kind"));
                        ps.setObject(3, c.get("channel"));
                        ps.setObject(4, c.get("name"));
                        ps.setObject(5, c.get("target"));
                        ps.setObject(6, c.get("note"));
                        ps.addBatch();
                    }
                    ps.executeBatch();
                }
            } catch (java.sql.SQLException e) {
                throw new RuntimeException("setContacts 失败: " + e.getMessage(), e);
            }
            return listContacts(taskId);
        });
    }
}
