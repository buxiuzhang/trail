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

        // 支持两种格式：
        // 1) 顶层 dataDir（新格式）
        // 2) 嵌套 trail.data-dir（旧格式）
        Object dd = map.get("dataDir");
        if (dd == null) {
            Object trailObj = map.get("trail");
            if (trailObj instanceof Map<?, ?> trailMap) {
                // SnakeYAML 保持 key 原样，所以需要同时检查 data-dir 和 dataDir
                dd = trailMap.get("data-dir");
                if (dd == null) {
                    dd = trailMap.get("dataDir");
                }
            }
        }

        Map<String, Object> rest = new HashMap<>(map);
        rest.remove("dataDir");
        rest.remove("trail");  // 避免 extra 中重复包含 trail 嵌套

        return new UserConfig(dd == null ? null : dd.toString(), rest);
    }

    public Map<String, Object> toMap() {
        Map<String, Object> m = new HashMap<>();
        if (dataDir != null) m.put("dataDir", dataDir);
        m.putAll(extra);
        return m;
    }
}
