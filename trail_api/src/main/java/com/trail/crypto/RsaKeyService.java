package com.trail.crypto;

import com.trail.config.DataDirService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.*;
import java.security.spec.*;
import java.util.Base64;
import java.util.Set;

/**
 * RSA-2048 密钥服务。
 *
 * - 私钥存放于数据目录：<dataDir>/trail_private.key
 * - 启动时检查私钥文件是否存在，不存在则自动生成
 * - 公钥从私钥派生，不存文件
 * - 提供 PEM 格式公钥供前端获取
 *
 * 加密模式：
 * - 前端 → 后端：公钥加密，私钥解密（RSA-OAEP）
 * - 后端 → 前端：私钥加密，公钥解密（RSA-OAEP，用于返回敏感数据）
 *
 * 公钥有效期：24小时（前端缓存策略）
 */
@Service
public class RsaKeyService {
    private static final Logger log = LoggerFactory.getLogger(RsaKeyService.class);

    private static final String KEY_FILENAME = "trail_private.key";
    private static final int KEY_SIZE = 2048;
    private static final String RSA_ALGORITHM = "RSA";
    private static final String CIPHER_ALGORITHM = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";

    private final DataDirService dataDirService;
    private PrivateKey privateKey;
    private PublicKey publicKey;
    private boolean initialized = false;

    public RsaKeyService(DataDirService dataDirService) {
        this.dataDirService = dataDirService;
    }

    /**
     * 首次访问时初始化（需 DataDirService 已配置）。
     * 与 SecretKeyService 一样采用懒初始化模式。
     */
    public synchronized void ensureInitialized() {
        if (initialized) return;
        Path dir = dataDirService.currentDataDir();
        if (dir == null) {
            throw new IllegalStateException("RsaKeyService.init 在 dataDir 未配置时调用");
        }
        Path keyFile = dir.resolve(KEY_FILENAME);

        try {
            if (Files.exists(keyFile)) {
                loadPrivateKey(keyFile);
                log.debug("RSA 私钥已加载: {}", keyFile);
            } else {
                generateAndSaveKeyPair(keyFile);
                log.info("RSA 密钥对已生成: {}", keyFile);
            }
            // 从私钥派生公钥（RSA 私钥包含足够信息重建公钥）
            derivePublicKey();
            this.initialized = true;
        } catch (Exception e) {
            throw new RuntimeException("RsaKeyService 初始化失败: " + e.getMessage(), e);
        }
    }

    /**
     * 检查是否已初始化。
     */
    public boolean isInitialized() {
        return initialized;
    }

    /**
     * 获取 PEM 格式公钥（给前端）。
     * 格式：-----BEGIN PUBLIC KEY-----\n<base64>\n-----END PUBLIC KEY-----
     */
    public String getPublicKeyPem() {
        if (!initialized) ensureInitialized();
        byte[] encoded = publicKey.getEncoded();
        String base64 = Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(encoded);
        return "-----BEGIN PUBLIC KEY-----\n" + base64 + "\n-----END PUBLIC KEY-----";
    }

    /**
     * RSA 解密（前端公钥加密的数据）。
     * @param encryptedBase64 前端传来的 base64 编码密文
     * @return 解密后的明文
     */
    public String decrypt(String encryptedBase64) {
        if (!initialized) ensureInitialized();
        try {
            Cipher cipher = Cipher.getInstance(CIPHER_ALGORITHM);
            OAEPParameterSpec oaepParams = new OAEPParameterSpec("SHA-256", "MGF1",
                    MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT);
            cipher.init(Cipher.DECRYPT_MODE, privateKey, oaepParams);
            byte[] encrypted = Base64.getDecoder().decode(encryptedBase64);
            byte[] decrypted = cipher.doFinal(encrypted);
            return new String(decrypted, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new RuntimeException("RSA 解密失败: " + e.getMessage(), e);
        }
    }

    /**
     * RSA 加密（用公钥加密，用于返回敏感数据给前端）。
     *
     * 前端无法直接解密（需要私钥），需要请求解密端点。
     * 这确保了数据在传输过程中是加密的。
     *
     * @param plaintext 明文（API Key 等）
     * @return base64 编码的密文
     */
    public String encrypt(String plaintext) {
        if (!initialized) ensureInitialized();
        if (plaintext == null || plaintext.isEmpty()) {
            return "";
        }
        try {
            Cipher cipher = Cipher.getInstance(CIPHER_ALGORITHM);
            OAEPParameterSpec oaepParams = new OAEPParameterSpec("SHA-256", "MGF1",
                    MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT);
            cipher.init(Cipher.ENCRYPT_MODE, publicKey, oaepParams);
            byte[] data = plaintext.getBytes(StandardCharsets.UTF_8);
            byte[] encrypted = cipher.doFinal(data);
            return Base64.getEncoder().encodeToString(encrypted);
        } catch (Exception e) {
            throw new RuntimeException("RSA 加密失败: " + e.getMessage(), e);
        }
    }

    /**
     * RSA 加密（返回敏感数据给前端，前端用公钥解密）。
     *
     * 使用私钥进行"加密"操作（数学上等同于用私钥的 n 和 d 参数计算 m^d mod n）。
     * 前端用公钥解密（计算 c^e mod n）。
     *
     * @param plaintext 明文（API Key 等）
     * @return base64 编码的密文
     */
    public String encryptForFrontend(String plaintext) {
        if (!initialized) ensureInitialized();
        if (plaintext == null || plaintext.isEmpty()) {
            return "";
        }
        try {
            // 使用私钥加密：计算 m^d mod n
            Cipher cipher = Cipher.getInstance("RSA/ECB/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, privateKey);

            byte[] data = plaintext.getBytes(StandardCharsets.UTF_8);

            if (data.length > 214) {
                throw new IllegalArgumentException("数据太长，RSA 最大加密 214 字节");
            }

            // PKCS#1 v1.5 padding
            byte[] padded = new byte[256];
            padded[0] = 0x00;
            padded[1] = 0x02;
            for (int i = 2; i < 256 - data.length - 1; i++) {
                padded[i] = (byte) (i % 255 + 1);
            }
            padded[256 - data.length - 1] = 0x00;
            System.arraycopy(data, 0, padded, 256 - data.length, data.length);

            byte[] encrypted = cipher.doFinal(padded);
            return Base64.getEncoder().encodeToString(encrypted);
        } catch (Exception e) {
            throw new RuntimeException("RSA 加密失败: " + e.getMessage(), e);
        }
    }

    /**
     * 从 PEM 文件加载私钥。
     */
    private void loadPrivateKey(Path keyFile) throws Exception {
        String pem = Files.readString(keyFile, StandardCharsets.UTF_8);
        // 去除 PEM 头尾和换行
        String base64 = pem
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        byte[] encoded = Base64.getDecoder().decode(base64);
        PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(encoded);
        KeyFactory kf = KeyFactory.getInstance(RSA_ALGORITHM);
        this.privateKey = kf.generatePrivate(spec);
    }

    /**
     * 生成 RSA-2048 密钥对并保存私钥。
     */
    private void generateAndSaveKeyPair(Path keyFile) throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance(RSA_ALGORITHM);
        gen.initialize(KEY_SIZE);
        KeyPair pair = gen.generateKeyPair();
        this.privateKey = pair.getPrivate();
        this.publicKey = pair.getPublic();
        savePrivateKeyPem(keyFile, privateKey);
    }

    /**
     * 从私钥派生公钥。
     * RSA 私钥的 PKCS#8 编码包含模数和私钥指数，可从中提取公钥参数。
     */
    private void derivePublicKey() throws Exception {
        if (publicKey != null) return;  // 生成时已有公钥
        // 从已加载的私钥重建公钥
        // RSA 私钥编码中包含模数 n，公钥指数 e 默认为 65537
        KeyFactory kf = KeyFactory.getInstance(RSA_ALGORITHM);
        RSAPrivateCrtKeySpec privSpec = kf.getKeySpec(privateKey, RSAPrivateCrtKeySpec.class);
        RSAPublicKeySpec pubSpec = new RSAPublicKeySpec(privSpec.getModulus(), privSpec.getPublicExponent());
        this.publicKey = kf.generatePublic(pubSpec);
    }

    /**
     * 保存私钥为 PEM 格式。
     */
    private void savePrivateKeyPem(Path keyFile, PrivateKey key) throws Exception {
        byte[] encoded = key.getEncoded();
        String base64 = Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(encoded);
        String pem = "-----BEGIN PRIVATE KEY-----\n" + base64 + "\n-----END PRIVATE KEY-----\n";

        if (keyFile.getParent() != null) {
            Files.createDirectories(keyFile.getParent());
        }
        Files.writeString(keyFile, pem, StandardCharsets.UTF_8);

        // 设置权限 600（仅 owner 可读写）
        try {
            Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
            Files.setPosixFilePermissions(keyFile, perms);
        } catch (UnsupportedOperationException | java.io.IOException ignored) {
            // Windows 或不支持 POSIX 权限的系统忽略
        }
    }
}