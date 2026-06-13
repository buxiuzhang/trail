package com.trail.web.controller;

import com.trail.crypto.RsaKeyService;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;

/**
 * 加密相关 API。
 *
 * - GET /api/crypto/public-key - 获取 RSA 公钥
 * - POST /api/crypto/decrypt - 解密数据（用于前端显示明文）
 */
@RestController
@RequestMapping("/api/crypto")
public class CryptoController {

    private final RsaKeyService rsaKeyService;

    public CryptoController(RsaKeyService rsaKeyService) {
        this.rsaKeyService = rsaKeyService;
    }

    /**
     * 获取 RSA 公钥。
     *
     * 返回：
     * - publicKey: PEM 格式公钥
     * - expiresAt: 建议过期时间（24小时后）
     *
     * 前端应缓存公钥到 localStorage，有效期 24 小时。
     */
    @GetMapping("/public-key")
    public Map<String, String> getPublicKey() {
        return Map.of(
            "publicKey", rsaKeyService.getPublicKeyPem(),
            "expiresAt", Instant.now().plus(24, ChronoUnit.HOURS).toString()
        );
    }

    /**
     * 解密数据。
     *
     * 用于前端显示加密的敏感数据（如 API Key）。
     * 前端发送后端返回的加密数据，后端解密后返回明文。
     *
     * 请求：
     * {
     *   "encrypted": "base64加密数据"
     * }
     *
     * 响应：
     * {
     *   "plaintext": "解密后的明文"
     * }
     */
    @PostMapping("/decrypt")
    public Map<String, String> decrypt(@RequestBody Map<String, String> request) {
        String encrypted = request.get("encrypted");
        if (encrypted == null || encrypted.isBlank()) {
            throw new IllegalArgumentException("缺少 encrypted 字段");
        }
        String plaintext = rsaKeyService.decrypt(encrypted);
        return Map.of("plaintext", plaintext);
    }
}