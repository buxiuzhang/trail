package com.trail.web.controller;

import com.trail.crypto.RsaKeyService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;

/**
 * 加密相关 API
 */
@RestController
@RequestMapping("/api/crypto")
@Tag(name = "加密服务", description = "RSA 公钥获取、数据解密")
public class CryptoController {

    private final RsaKeyService rsaKeyService;

    public CryptoController(RsaKeyService rsaKeyService) {
        this.rsaKeyService = rsaKeyService;
    }

    @Operation(summary = "获取 RSA 公钥", description = "获取公钥用于前端加密敏感数据（如 API Key），建议缓存 24 小时")
    @GetMapping("/public-key")
    public Map<String, String> getPublicKey() {
        return Map.of(
            "publicKey", rsaKeyService.getPublicKeyPem(),
            "expiresAt", Instant.now().plus(24, ChronoUnit.HOURS).toString()
        );
    }

    @Operation(summary = "解密数据", description = "解密前端传来的 RSA 加密数据，返回明文")
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
