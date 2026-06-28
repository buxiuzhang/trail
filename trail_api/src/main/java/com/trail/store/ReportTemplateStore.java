package com.trail.store;

import com.trail.db.SqliteDb;
import com.trail.store.exception.NotFoundException;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class ReportTemplateStore {

    private final SqliteDb db;

    public ReportTemplateStore(SqliteDb db) {
        this.db = db;
    }

    public List<Map<String, Object>> findAll() {
        return db.query("SELECT * FROM report_templates ORDER BY sort_order ASC, created_at ASC");
    }

    public List<Map<String, Object>> findAllEnabled() {
        return db.query("SELECT * FROM report_templates WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC");
    }

    public Map<String, Object> findById(String id) {
        List<Map<String, Object>> rows = db.query("SELECT * FROM report_templates WHERE id = ?", id);
        if (rows.isEmpty()) throw new NotFoundException("导出模板不存在：" + id);
        return rows.get(0);
    }

    public Map<String, Object> save(String name, String description, String template, int sortOrder) {
        String id = UUID.randomUUID().toString();
        db.update("""
            INSERT INTO report_templates (id, name, description, template, enabled, sort_order)
            VALUES (?, ?, ?, ?, 1, ?)
            """, id, name, description, template, sortOrder);
        return findById(id);
    }

    public Map<String, Object> update(String id, String name, String description,
                                      String template, Boolean enabled, Integer sortOrder) {
        findById(id);
        db.update("""
            UPDATE report_templates
               SET name        = COALESCE(?, name),
                   description = COALESCE(?, description),
                   template    = COALESCE(?, template),
                   enabled     = COALESCE(?, enabled),
                   sort_order  = COALESCE(?, sort_order)
             WHERE id = ?
            """, name, description, template,
                enabled == null ? null : (enabled ? 1 : 0),
                sortOrder, id);
        return findById(id);
    }

    public void delete(String id) {
        int n = db.update("DELETE FROM report_templates WHERE id = ? RETURNING id", id);
        if (n == 0) throw new NotFoundException("导出模板不存在：" + id);
    }
}
