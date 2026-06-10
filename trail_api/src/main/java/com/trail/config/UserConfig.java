package com.trail.config;

import java.util.HashMap;
import java.util.Map;

/** 用户级配置（存于 OS-specific 路径，详见 PathUtils.userConfigPath）。 */
public record UserConfig(String dataDir, Map<String, Object> extra) {

    public UserConfig {
        if (extra == null) extra = new HashMap<>();
    }

    public static UserConfig empty() {
        return new UserConfig(null, new HashMap<>());
    }

    public static UserConfig fromMap(Map<String, Object> map) {
        if (map == null) return empty();
        Object dd = map.get("dataDir");
        Map<String, Object> rest = new HashMap<>(map);
        rest.remove("dataDir");
        return new UserConfig(dd == null ? null : dd.toString(), rest);
    }

    public Map<String, Object> toMap() {
        Map<String, Object> m = new HashMap<>();
        if (dataDir != null) m.put("dataDir", dataDir);
        m.putAll(extra);
        return m;
    }
}
