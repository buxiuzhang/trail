package com.trail.crypto;

import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * AES-256-GCM 对称加密。
 *
 * 密文布局（base64 编码）：IV(12) || ciphertext || authTag(16)
 *
 * 与 Python Fernet 互不兼容——迁移期走 PlainYamlImporter；新写入一律 AES-GCM。
 */
@Component
public class AesGcmCipher {
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 128;  // bits
    private static final SecureRandom RNG = new SecureRandom();

    private final SecretKeyService keys;

    public AesGcmCipher(SecretKeyService keys) {
        this.keys = keys;
    }

    public String encrypt(String plain) {
        if (plain == null || plain.isEmpty()) return "";
        try {
            byte[] iv = new byte[GCM_IV_LENGTH];
            RNG.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, keys.aesKey(), new GCMParameterSpec(GCM_TAG_LENGTH, iv));
            byte[] ct = cipher.doFinal(plain.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            ByteBuffer buf = ByteBuffer.allocate(iv.length + ct.length);
            buf.put(iv).put(ct);
            return Base64.getEncoder().encodeToString(buf.array());
        } catch (Exception e) {
            throw new RuntimeException("AES-GCM 加密失败: " + e.getMessage(), e);
        }
    }

    public String decrypt(String token) {
        if (token == null || token.isEmpty()) return "";
        try {
            byte[] raw = Base64.getDecoder().decode(token);
            if (raw.length < GCM_IV_LENGTH + 16) return "";
            ByteBuffer buf = ByteBuffer.wrap(raw);
            byte[] iv = new byte[GCM_IV_LENGTH];
            buf.get(iv);
            byte[] ct = new byte[raw.length - GCM_IV_LENGTH];
            buf.get(ct);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, keys.aesKey(), new GCMParameterSpec(GCM_TAG_LENGTH, iv));
            byte[] pt = cipher.doFinal(ct);
            return new String(pt, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * 检测是否为 Python Fernet token（base64 头 gAAAAA）。
     * 仅供审计读，不写库。
     */
    public boolean isLegacyFernet(String token) {
        if (token == null || token.length() < 10) return false;
        try {
            byte[] raw = Base64.getUrlDecoder().decode(token);
            return raw.length > 0 && raw[0] == (byte) 0x80;
        } catch (Exception e) {
            return false;
        }
    }
}
