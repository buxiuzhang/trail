package com.trail.util;

import java.nio.file.Path;
import java.nio.file.Paths;

public final class PathUtils {
    private PathUtils() {}

    /** 跨平台 user config 路径（用户级 trail 配置）。
     *  三平台统一：<userHome>/.trail/config.yaml
     *  - macOS:  /Users/<user>/.trail/config.yaml
     *  - Linux:  /home/<user>/.trail/config.yaml
     *  - Windows: C:\Users\<user>\.trail\config.yaml
     */
    public static Path userConfigPath() {
        String home = System.getProperty("user.home");
        return Paths.get(home, ".trail", "config.yaml");
    }

    /** 默认数据目录：~/.trail/data（无配置时的建议值，需用户确认后才初始化） */
    public static Path defaultDataDir() {
        String home = System.getProperty("user.home");
        return Paths.get(home, ".trail", "data");
    }

    /** 旧 trail_app/utils.get_data_dir() 等价：返回 <项目根>/data 绝对路径（fallback 用） */
    public static Path resolveDataDir(String configured) {
        Path p = Paths.get(configured == null ? "../data" : configured);
        return p.isAbsolute() ? p : p.toAbsolutePath();
    }
}
