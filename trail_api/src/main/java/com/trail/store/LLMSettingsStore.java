package com.trail.store;

import com.trail.crypto.AesGcmCipher;
import com.trail.db.SqliteDb;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** LLM 配置加密读写。所有 value 加密后存 SQLite。 */
@Component
public class LLMSettingsStore {

    private final SqliteDb db;
    private final AesGcmCipher cipher;

    public LLMSettingsStore(SqliteDb db, AesGcmCipher cipher) {
        this.db = db;
        this.cipher = cipher;
    }

    public Map<String, String> getAll() {
        Map<String, String> out = new HashMap<>();
        for (Map<String, Object> r : db.query("SELECT key, value FROM llm_settings")) {
            String k = (String) r.get("key");
            String v = (String) r.get("value");
            // motto 历史是明文
            if ("motto".equals(k)) {
                out.put(k, v);
            } else {
                out.put(k, cipher.decrypt(v));
            }
        }
        return out;
    }

    public String get(String key) {
        List<Map<String, Object>> rows = db.query("SELECT value FROM llm_settings WHERE key = ?", key);
        if (rows.isEmpty()) return null;
        String v = (String) rows.get(0).get("value");
        if ("motto".equals(key)) return v;
        return cipher.decrypt(v);
    }

    public void save(String key, String value) {
        String stored = "motto".equals(key) ? (value == null ? "" : value) : cipher.encrypt(value == null ? "" : value);
        db.update(
            "INSERT INTO llm_settings (key, value) VALUES (?, ?)"
          + " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            key, stored);
    }

    public void delete(String key) {
        db.update("DELETE FROM llm_settings WHERE key = ?", key);
    }
}
