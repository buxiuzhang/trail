package com.trail.store;

import com.trail.db.SqliteDb;
import com.trail.store.exception.NotFoundException;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class SkillStore {

    private final SqliteDb db;

    public SkillStore(SqliteDb db) {
        this.db = db;
    }

    public List<Map<String, Object>> findAll() {
        return db.query("SELECT * FROM skills ORDER BY sort_order ASC, created_at ASC");
    }

    public List<Map<String, Object>> findAllEnabled() {
        return db.query("SELECT * FROM skills WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC");
    }

    public List<Map<String, Object>> findEnabledByScope(String scope) {
        return db.query(
            "SELECT * FROM skills WHERE enabled = 1 AND scope LIKE ? ORDER BY sort_order ASC, created_at ASC",
            "%\"" + scope + "\"%");
    }

    public Map<String, Object> findById(String id) {
        List<Map<String, Object>> rows = db.query("SELECT * FROM skills WHERE id = ?", id);
        if (rows.isEmpty()) throw new NotFoundException("Skill 不存在：" + id);
        return rows.get(0);
    }

    public Map<String, Object> findEnabledByName(String name) {
        List<Map<String, Object>> rows = db.query(
            "SELECT * FROM skills WHERE enabled = 1 AND name = ? LIMIT 1", name);
        if (rows.isEmpty()) throw new NotFoundException("Skill 不存在或已禁用：" + name);
        return rows.get(0);
    }

    public Map<String, Object> save(String name, String description, String systemPrompt,
                                    int sortOrder, String scope, String injectionMode) {
        String id = UUID.randomUUID().toString();
        String scopeVal = (scope != null && !scope.isBlank()) ? scope : "[\"chat\"]";
        String modeVal = (injectionMode != null && !injectionMode.isBlank()) ? injectionMode : "full";
        db.update("""
            INSERT INTO skills (id, name, description, system_prompt, enabled, sort_order, scope, injection_mode)
            VALUES (?, ?, ?, ?, 1, ?, ?, ?)
            """, id, name, description, systemPrompt, sortOrder, scopeVal, modeVal);
        return findById(id);
    }

    public Map<String, Object> update(String id, String name, String description,
                                      String systemPrompt, Boolean enabled,
                                      Integer sortOrder, String scope, String injectionMode) {
        findById(id);
        db.update("""
            UPDATE skills
               SET name           = COALESCE(?, name),
                   description    = COALESCE(?, description),
                   system_prompt  = COALESCE(?, system_prompt),
                   enabled        = COALESCE(?, enabled),
                   sort_order     = COALESCE(?, sort_order),
                   scope          = COALESCE(?, scope),
                   injection_mode = COALESCE(?, injection_mode)
             WHERE id = ?
            """, name, description, systemPrompt,
                enabled == null ? null : (enabled ? 1 : 0),
                sortOrder, scope, injectionMode, id);
        return findById(id);
    }

    public void delete(String id) {
        int n = db.update("DELETE FROM skills WHERE id = ? RETURNING id", id);
        if (n == 0) throw new NotFoundException("Skill 不存在：" + id);
    }
}
