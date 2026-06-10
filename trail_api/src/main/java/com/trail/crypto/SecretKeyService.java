package com.trail.crypto;

import com.trail.config.DataDirService;
import com.trail.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.NoSuchAlgorithmException;
import java.security.spec.InvalidKeySpecException;
import java.util.Set;

/**
 * 32 字节 AES key 管理（M8 懒初始化版）。
 *
 * - 启动期不读 key；首次访问 dataDir 时（DataDirService.openConnection 之后）才 init
 * - 文件不存在 / 大小 ≠ 32：派生新 key（PBKDF2 + 固定盐 + hostname），写盘到 <dataDir>/.secret_key
 * - 路径不再来自配置 yaml，**完全由 DataDirService 决定**（即 <dataDir>/.secret_key）
 */
@Component
public class SecretKeyService {
    private static final Logger log = LoggerFactory.getLogger(SecretKeyService.class);
    private static final int KEY_LENGTH_BYTES = 32;
    private static final String SECRET_FILE_NAME = ".secret_key";
    private static final String DEFAULT_SALT = "trail_v2_secret_salt_2026";
    private static final int DEFAULT_ITERATIONS = 480_000;

    private final AppProperties props;
    private final DataDirService dataDir;
    private SecretKey aesKey;
    private Path keyFile;
    private boolean initialized = false;

    public SecretKeyService(AppProperties props, DataDirService dataDir) {
        this.props = props;
        this.dataDir = dataDir;
    }

    /** 首次访问时初始化（DataDirService 已 configure） */
    public synchronized void ensureInitialized() {
        if (initialized) return;
        Path dir = dataDir.currentDataDir();
        if (dir == null) {
            throw new IllegalStateException("SecretKeyService.init 在 dataDir 未配置时调用");
        }
        this.keyFile = dir.resolve(SECRET_FILE_NAME);

        try {
            byte[] keyBytes;
            if (Files.exists(keyFile) && Files.size(keyFile) == KEY_LENGTH_BYTES) {
                keyBytes = Files.readAllBytes(keyFile);
                log.info("读 .secret_key（raw 32 字节）from {}", keyFile);
            } else {
                keyBytes = derive();
                writeKeyFile(keyBytes);
                log.info("已派生新 .secret_key 写入 {}", keyFile);
            }
            this.aesKey = new SecretKeySpec(keyBytes, "AES");
            this.initialized = true;
        } catch (Exception e) {
            throw new RuntimeException("SecretKeyService 初始化失败: " + e.getMessage(), e);
        }
    }

    public SecretKey aesKey() {
        if (!initialized) ensureInitialized();
        return aesKey;
    }

    public Path keyFile() { return keyFile; }
    public boolean isInitialized() { return initialized; }

    private byte[] derive() throws NoSuchAlgorithmException, InvalidKeySpecException {
        String host = hostname();
        String salt = DEFAULT_SALT;
        int iter = DEFAULT_ITERATIONS;
        if (props != null) {
            // 可选从 AppProperties 覆盖（暂未在 application.yml 暴露；保留口子）
        }
        PBEKeySpec spec = new PBEKeySpec(
                host.toCharArray(), salt.getBytes(), iter, KEY_LENGTH_BYTES * 8);
        SecretKeyFactory skf = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        return skf.generateSecret(spec).getEncoded();
    }

    private String hostname() {
        try {
            String h = java.net.InetAddress.getLocalHost().getHostName();
            return (h == null || h.isEmpty()) ? "trail-local" : h;
        } catch (Exception e) {
            return "trail-local";
        }
    }

    private void writeKeyFile(byte[] key) throws IOException {
        if (keyFile.getParent() != null) Files.createDirectories(keyFile.getParent());
        Files.write(keyFile, key);
        try {
            Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
            Files.setPosixFilePermissions(keyFile, perms);
        } catch (UnsupportedOperationException | IOException ignored) {}
    }
}
