package com.trail.store;

import com.trail.db.SqliteDb;
import com.trail.store.exception.NotFoundException;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class McpServerStore {

    private final SqliteDb db;

    public McpServerStore(SqliteDb db) {
        this.db = db;
    }

    public List<Map<String, Object>> findAll() {
        return db.query("SELECT * FROM mcp_servers ORDER BY created_at ASC");
    }

    public List<Map<String, Object>> findAllEnabled() {
        return db.query("SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY created_at ASC");
    }

    public Map<String, Object> findById(String id) {
        List<Map<String, Object>> rows = db.query("SELECT * FROM mcp_servers WHERE id = ?", id);
        if (rows.isEmpty()) throw new NotFoundException("MCP Server 不存在：" + id);
        return rows.get(0);
    }

    public Map<String, Object> save(String name, String type,
                                    String command, String args, String env,
                                    String url, String headers) {
        String id = UUID.randomUUID().toString();
        db.update("""
            INSERT INTO mcp_servers (id, name, type, command, args, env, url, headers, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            """, id, name, type, command, args, env, url, headers);
        return findById(id);
    }

    public Map<String, Object> update(String id, String name, String type,
                                      String command, String args, String env,
                                      String url, String headers, Boolean enabled) {
        findById(id);
        db.update("""
            UPDATE mcp_servers
               SET name    = COALESCE(?, name),
                   type    = COALESCE(?, type),
                   command = COALESCE(?, command),
                   args    = COALESCE(?, args),
                   env     = COALESCE(?, env),
                   url     = COALESCE(?, url),
                   headers = COALESCE(?, headers),
                   enabled = COALESCE(?, enabled)
             WHERE id = ?
            """, name, type, command, args, env, url, headers, enabled == null ? null : (enabled ? 1 : 0), id);
        return findById(id);
    }

    public void delete(String id) {
        int n = db.update("DELETE FROM mcp_servers WHERE id = ? RETURNING id", id);
        if (n == 0) throw new NotFoundException("MCP Server 不存在：" + id);
    }
}
