package com.trail.config;

import com.trail.crypto.PlainYamlImporter;
import com.trail.crypto.SecretKeyService;
import com.trail.db.SqliteDb;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 启动期检查（M8 重写版）。
 *
 * 1) DataDirService.init() 读优先级链（env > user config > 未配置）
 * 2) 若已配置：SqliteDb.openConnection + ensureSchema + SecretKeyService.ensureInitialized + PlainYamlImporter
 * 3) 若未配置：service bean 继续创建（HTTP 仍起）；SqliteDb.conn=null，运行时 503 NEEDS_DATA_DIR
 */
@Component
public class StartupChecks {
    private static final Logger log = LoggerFactory.getLogger(StartupChecks.class);

    private final DataDirService dataDir;
    private final SqliteDb db;
    private final SecretKeyService keys;
    private final PlainYamlImporter importer;

    public StartupChecks(DataDirService dataDir, SqliteDb db,
                         SecretKeyService keys, PlainYamlImporter importer) {
        this.dataDir = dataDir;
        this.db = db;
        this.keys = keys;
        this.importer = importer;
    }

    @PostConstruct
    public void run() {
        dataDir.init();
        if (dataDir.isConfigured()) {
            db.openConnection(dataDir.currentDataDir());
            db.ensureSchema();
            dataDir.ensureSubdirectories(dataDir.currentDataDir());
            LogSetup.configureFileAppender(dataDir.currentDataDir().resolve("logs"));
            keys.ensureInitialized();
            importer.migrateIfPresent();
            db.compressAiRecords();   // M16: 存量 ai_records 压缩迁移（已压缩则跳过）
            db.pruneAiRecords(30);    // 清理 30 天前的 ai_records
            log.info("启动就绪：dataDir={}", dataDir.currentDataDir());
        } else {
            log.warn("未配置数据目录。HTTP 已起，/api/*（health + data-dir 探测除外）返 503 NEEDS_DATA_DIR。");
        }
    }
}
