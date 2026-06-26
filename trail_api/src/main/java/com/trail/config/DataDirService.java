package com.trail.config;

import com.trail.db.SqliteDb;
import com.trail.store.VectorStore;
import com.trail.store.exception.DataDirNotConfiguredException;
import com.trail.util.PathUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/**
 * 数据目录运行时管理（M8 核心）。
 *
 * 优先级链（启动期）：
 *   1) env TRAIL_DATA_DIR（命令行调优）
 *   2) user config yaml（用户首次指定后持久化）
 *   3) 未配置模式（首次启动）
 *
 * 启动期：PostConstruct 跑完 init()。未配置时 configured=false，
 *   SqliteDb 不开连接；其它 bean 调 SqliteDb.query() 会抛 DataDirNotConfiguredException
 *   → 503 {code: "NEEDS_DATA_DIR"}。
 *
 * 运行时切换：switchTo(Path) 关旧 conn + 写 user config + 开新 conn + ensureSchema。
 */
@Service
public class DataDirService {
    private static final Logger log = LoggerFactory.getLogger(DataDirService.class);

    private final Path userConfigPath;
    private final SqliteDb db;
    private final VectorStore vectorStore;
    private volatile Path currentDataDir;
    private volatile boolean configured;

    public DataDirService(SqliteDb db, VectorStore vectorStore) {
        this.userConfigPath = PathUtils.userConfigPath();
        this.db = db;
        this.vectorStore = vectorStore;
    }

    /** 启动期初始化（不主动开 conn，留给 StartupChecks 调 openAndInitialize） */
    public void init() {
        String envDir = System.getenv("TRAIL_DATA_DIR");
        if (envDir != null && !envDir.isBlank()) {
            Path p = Path.of(envDir).toAbsolutePath();
            log.info("数据目录来自 env TRAIL_DATA_DIR: {}", p);
            try {
                Files.createDirectories(p);
            } catch (IOException e) {
                log.warn("无法创建 env 指定的数据目录 {}: {}", p, e.getMessage());
            }
            applyDataDir(p, false);
            return;
        }
        if (Files.exists(userConfigPath)) {
            try {
                String yaml = Files.readString(userConfigPath);
                Object loaded = new Yaml().load(yaml);
                if (loaded instanceof Map<?, ?> m) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> raw = (Map<String, Object>) m;
                    UserConfig cfg = UserConfig.fromMap(raw);
                    if (cfg.dataDir() != null) {
                        Path p = Path.of(cfg.dataDir()).toAbsolutePath();
                        log.info("数据目录来自 user config: {}", p);
                        applyDataDir(p, false);
                        return;
                    }
                }
            } catch (IOException e) {
                log.warn("user config 读取失败: {}", e.getMessage());
            }
        }
        // 首次启动：自动初始化默认数据目录，写入 user config
        Path defaultDir = PathUtils.defaultDataDir();
        log.info("首次启动，自动初始化默认数据目录: {}", defaultDir);
        try {
            Files.createDirectories(defaultDir);
            writeUserConfig(defaultDir);
            log.info("已生成默认配置文件: {}", userConfigPath);
        } catch (IOException e) {
            log.warn("自动初始化默认数据目录失败: {}，请手动配置", e.getMessage());
            return;
        }
        applyDataDir(defaultDir, false);
    }

    /** 检查是否已配置；未配置抛 DataDirNotConfiguredException（给 GlobalExceptionHandler 转 503） */
    public void requireConfigured() {
        if (!configured) throw new DataDirNotConfiguredException();
    }

    public boolean isConfigured() { return configured; }
    public Path currentDataDir() { return currentDataDir; }
    public Path defaultDataDir() { return PathUtils.defaultDataDir(); }
    public Path userConfigPath() { return userConfigPath; }
    /** 主库文件绝对路径（<dataDir>/db/tasks.sqlite），未配置时 null */
    public Path currentDbPath() {
        return currentDataDir == null ? null : currentDataDir.resolve("db/tasks.sqlite");
    }

    /**
     * 在数据目录下创建运行时需要的子目录：
     *   exports/      — md 导出
     *   attachments/  — 未来：截图/附件
     *   logs/         — 系统运行日志（按天滚动）
     */
    public void ensureSubdirectories(Path dataDir) {
        try {
            Files.createDirectories(dataDir.resolve("exports"));
            Files.createDirectories(dataDir.resolve("attachments"));
            Files.createDirectories(dataDir.resolve("logs"));
            Files.createDirectories(dataDir.resolve("vectors"));
            log.info("子目录已就绪：exports/ attachments/ logs/ vectors/");
        } catch (IOException e) {
            log.warn("创建子目录失败: {}", e.getMessage());
        }
    }

    /**
     * 应用数据目录 + （可选）打开连接。
     * @param openConn true = 立即开 conn + ensureSchema；false = 仅记录路径（用于 init 阶段让 StartupChecks 之后开）
     */
    public void applyDataDir(Path dir, boolean openConn) {
        this.currentDataDir = dir;
        this.configured = dir != null;
        if (openConn) {
            db.openConnection(dir);
            db.ensureSchema();
            vectorStore.open(dir);
        }
    }

    /**
     * 运行时切换数据目录（PUT /api/settings/data-dir）。
     * 校验 → 防覆盖检查 → mkdir → 可写测试 → 关旧 conn → 写 user config →
     * 开新 conn → ensureSchema → 子目录（exports/attachments/logs）→ 文件日志。
     */
    public synchronized void switchTo(String pathStr) {
        if (pathStr == null || pathStr.isBlank()) {
            throw new IllegalArgumentException("路径不能为空");
        }
        Path newDir = Path.of(pathStr).toAbsolutePath().normalize();
        if (!newDir.isAbsolute()) {
            throw new IllegalArgumentException("请输入绝对路径");
        }

        // 1) 防覆盖：目标目录已有数据则拒绝切换，避免误连旧库导致数据丢失。
        if (Files.isDirectory(newDir)) {
            try (var s = java.nio.file.Files.list(newDir)) {
                boolean hasFiles = s.anyMatch(p -> !p.getFileName().toString().startsWith("."));
                if (hasFiles) {
                    throw new IllegalArgumentException(
                        "目标目录 " + newDir + " 已有数据，不能切换。请选择空目录或先清空后重试。");
                }
            } catch (IllegalArgumentException e) { throw e; }
            catch (IOException ignored) {}
        }

        // 2) mkdir + 可写测试
        try {
            Files.createDirectories(newDir);
        } catch (IOException e) {
            throw new RuntimeException("无法创建目录 " + newDir + "：" + e.getMessage(), e);
        }
        Path canary = newDir.resolve(".trail-write-test");
        try {
            Files.writeString(canary, "ok");
            Files.deleteIfExists(canary);
        } catch (IOException e) {
            throw new RuntimeException("目录不可写 " + newDir + "：" + e.getMessage(), e);
        }

        // 3) 关旧 conn（如有）
        if (configured) {
            try { db.closeConnection(); } catch (Exception ignored) {}
            try { vectorStore.close(); } catch (Exception ignored) {}
        }

        // 4) 写 user config yaml
        writeUserConfig(newDir);

        // 5) 开新 conn + ensureSchema + 子目录 + 文件日志
        this.currentDataDir = newDir;
        this.configured = true;
        db.openConnection(newDir);
        db.ensureSchema();
        vectorStore.open(newDir);
        ensureSubdirectories(newDir);
        LogSetup.configureFileAppender(newDir.resolve("logs"));

        log.info("数据目录已切换到: {}", newDir);
    }

    private void writeUserConfig(Path newDir) {
        try {
            Files.createDirectories(userConfigPath.getParent());
            Map<String, Object> map = new HashMap<>();
            map.put("dataDir", newDir.toString());
            DumperOptions opts = new DumperOptions();
            opts.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
            String dumped = new Yaml(opts).dump(map);
            Path tmp = Files.createTempFile(userConfigPath.getParent(), ".config.", ".yaml.tmp");
            Files.writeString(tmp, dumped);
            Files.move(tmp, userConfigPath, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new RuntimeException("写 user config 失败: " + e.getMessage(), e);
        }
    }
}
