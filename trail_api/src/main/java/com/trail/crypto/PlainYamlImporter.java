package com.trail.crypto;

import com.trail.config.DataDirService;
import com.trail.store.LLMSettingsStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Map;

/**
 * 启动期预迁移：读 <dataDir>/llm_settings.plain.yaml → AES-GCM 加密入库 → 重命名为 .done。
 *
 * M8：路径由 DataDirService 决定（不再是 yaml 配置）。
 * 由 StartupChecks 在 ensureSchema 之后调用一次。
 */
@Component
public class PlainYamlImporter {
    private static final Logger log = LoggerFactory.getLogger(PlainYamlImporter.class);
    private static final String PLAIN_FILE = "llm_settings.plain.yaml";
    private static final String DONE_SUFFIX = ".done";

    private final DataDirService dataDir;
    private final LLMSettingsStore store;

    public PlainYamlImporter(DataDirService dataDir, LLMSettingsStore store) {
        this.dataDir = dataDir;
        this.store = store;
    }

    public void migrateIfPresent() {
        if (!dataDir.isConfigured()) {
            log.debug("dataDir 未配置，跳过预迁移");
            return;
        }
        Path dataDirPath = dataDir.currentDataDir();
        Path plain = dataDirPath.resolve(PLAIN_FILE);
        Path done = dataDirPath.resolve(PLAIN_FILE + DONE_SUFFIX);

        if (!Files.exists(plain)) {
            if (Files.exists(done)) {
                log.info("llm_settings 迁移已完成（.done 标记存在），跳过");
            } else {
                log.debug("未发现 {}，无预迁移任务", plain);
            }
            return;
        }

        try {
            String yamlText = Files.readString(plain);
            Map<String, Object> cfg = new Yaml().load(yamlText);
            if (cfg == null || cfg.isEmpty()) {
                log.warn("{} 为空，跳过迁移", plain);
                return;
            }
            int n = 0;
            for (Map.Entry<String, Object> e : cfg.entrySet()) {
                String k = e.getKey();
                String v = e.getValue() == null ? "" : String.valueOf(e.getValue());
                store.save(k, v);
                n++;
            }
            log.info("预迁移完成：{} 项已 AES-GCM 加密入库", n);
            Files.move(plain, done, StandardCopyOption.REPLACE_EXISTING);
            log.info("重命名 {} → {}{}", plain.getFileName(), plain.getFileName(), DONE_SUFFIX);
        } catch (IOException ex) {
            throw new RuntimeException("预迁移失败: " + ex.getMessage(), ex);
        }
    }
}
