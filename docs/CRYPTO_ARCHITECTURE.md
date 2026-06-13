# RSA-2048 敏感数据加密传输架构

> 本文档描述前后端敏感数据（LLM API Key、MySQL 密码等）的加密传输机制。

## 背景

项目即将提交到 Gitee 平台，需要确保敏感数据在前后端传输过程中始终加密，防止 API Key 等凭证在网络传输中泄露。

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                    ~/.trail/ 目录结构                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ~/.trail/                                                      │
│  ├── trail_private.key  ← RSA-2048 私钥（PEM格式）               │
│  │                              权限600，用户自行备份              │
│  ├── .secret_key         ← AES-GCM 加密密钥（已有）               │
│  └── data/                                                      │
│      ├── db/tasks.sqlite                                        │
│      └── attachments/                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 密钥说明

| 密钥 | 用途 | 管理方式 |
|------|------|----------|
| `trail_private.key` | RSA-2048 私钥，用于解密前端传输的敏感数据 | 后端启动时自动生成/加载 |
| `.secret_key` | AES-GCM 密钥，用于加密存储到 SQLite | 已有实现 |
| RSA 公钥 | 加密敏感数据，前端通过 API 获取 | 从私钥派生，不存文件 |

---

## 数据流程

### 保存敏感数据

```
┌─────────────────────────────────────────────────────────────────┐
│  1. 用户在 Settings 页面输入 API Key                             │
│  2. 前端从 localStorage 获取公钥（首次从 API 获取）               │
│  3. Web Crypto API 用公钥加密 API Key                            │
│  4. PUT /api/settings/llm { api_key_encrypted: "base64密文" }   │
│  5. 后端 RSA 私钥解密                                            │
│  6. AES-GCM 加密后存入 SQLite                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 读取设置

```
┌─────────────────────────────────────────────────────────────────┐
│  GET /api/settings/llm                                          │
│  返回:                                                           │
│    - apiKeyMasked: "sk-****...****" (遮蔽值，用于显示)           │
│    - apiKeyEncrypted: "base64密文" (加密的完整值)               │
│                                                                 │
│  前端展示：                                                       │
│    - 默认显示遮蔽值                                               │
│    - 用户点击"显示"按钮 → 用公钥解密 apiKeyEncrypted → 显示明文   │
│                                                                 │
│  用户修改时：                                                     │
│    - 显示空输入框 + placeholder 显示遮蔽值                        │
│    - 用户输入新值才加密传输                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 公钥缓存策略

### 有效期：24 小时

公钥本身不过期，但前端缓存设置 24 小时有效期，原因：

1. **私钥更换恢复**：用户更换私钥后最多 24 小时自动恢复
2. **减少请求**：每天首次打开页面获取新公钥，当天后续操作用缓存
3. **平衡安全与体验**：不过于频繁请求，也不过于长期缓存

### 缓存结构

```typescript
interface PublicKeyCache {
  publicKey: string      // PEM 格式公钥
  expiresAt: number      // 过期时间戳（毫秒）
}
```

### 缓存逻辑

```typescript
// 1. 读取 localStorage 缓存
// 2. 检查是否过期（Date.now() < expiresAt）
// 3. 未过期 → 使用缓存
// 4. 过期/不存在 → 请求 API 获取新公钥
```

---

## API 设计

### GET /api/crypto/public-key

获取 RSA 公钥。

**响应：**

```json
{
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBg...\n-----END PUBLIC KEY-----",
  "expiresAt": "2025-01-15T10:30:00Z"
}
```

| 字段 | 说明 |
|------|------|
| `publicKey` | PEM 格式 RSA 公钥 |
| `expiresAt` | 建议过期时间（ISO 8601，24小时后） |

### PUT /api/settings/llm

保存 LLM 设置，支持加密传输。

**请求：**

```json
{
  "api_key_encrypted": "base64编码的RSA加密密文",
  "base_url": "https://api.anthropic.com",
  "model": "claude-sonnet-4-6"
}
```

| 字段 | 说明 |
|------|------|
| `api_key_encrypted` | RSA 加密后的 API Key（base64） |
| `api_key` | 明文 API Key（已废弃，不再支持） |

**响应：**

```json
{
  "ok": true
}
```

### GET /api/settings/llm

获取 LLM 设置。

**响应：**

```json
{
  "apiKeyMasked": "sk-****...****",
  "apiKeyEncrypted": "base64编码的RSA加密密文",
  "baseUrl": "https://api.anthropic.com",
  "model": "claude-sonnet-4-6"
}
```

| 字段 | 说明 |
|------|------|
| `apiKeyMasked` | 遮蔽后的 API Key（格式：`前4位****后4位`） |
| `apiKeyEncrypted` | 后端用私钥加密的完整 API Key，前端用公钥解密后显示明文 |

---

## 加密算法

### 后端（Java）

| 操作 | 算法 | 说明 |
|------|------|------|
| 密钥生成 | RSA-2048 | `KeyPairGenerator.getInstance("RSA")` |
| 解密（前端→后端） | RSA-OAEP | `RSA/ECB/OAEPWithSHA-256AndMGF1Padding`，私钥解密 |
| 加密（后端→前端） | RSA-OAEP | 公钥加密，前端用公钥解密 |
| 存储 | AES-256-GCM | 已有实现 |

### 前端（Web Crypto API）

| 操作 | 算法 | 说明 |
|------|------|------|
| 加密（前端→后端） | RSA-OAEP | 公钥加密，`window.crypto.subtle.encrypt()` |
| 解密（后端→前端） | RSA-OAEP | 公钥解密，`window.crypto.subtle.decrypt()` |
| 公钥导入 | SPKI | PEM → `importKey('spki', ...)` |

---

## 安全保证

| 保证项 | 实现方式 |
|--------|----------|
| 代码中无硬编码 API Key | 用户在前端配置，后端无默认值 |
| 传输加密 | RSA-2048 公钥加密，私钥解密 |
| 存储加密 | AES-GCM 加密存入 SQLite |
| GET 响应安全 | 只返回遮蔽值 `sk-****...****` |
| 私钥不入库 | `~/.trail/` 目录，git 忽略 |
| 公钥动态获取 | API 获取，前端缓存 localStorage |

---

## 文件清单

### 后端新增文件

| 文件 | 说明 |
|------|------|
| `RsaKeyService.java` | RSA 密钥生成/加载/解密 |
| `CryptoController.java` | 公钥 API 端点 |

### 后端修改文件

| 文件 | 修改内容 |
|------|----------|
| `LlmSettingsController.java` | 支持 `api_key_encrypted` 字段，GET 返回遮蔽值 |
| `DatabaseSettingsController.java` | MySQL 密码同样处理（如适用） |

### 前端新增文件

| 文件 | 说明 |
|------|------|
| `src/api/crypto.ts` | RSA 加密工具 + 公钥获取 |

### 前端修改文件

| 文件 | 修改内容 |
|------|----------|
| `SettingsPage.tsx` | API Key 加密传输 |

---

## 验证步骤

```bash
# 1. 首次启动后端，检查密钥自动生成
ls -la ~/.trail/trail_private.key
# 应显示: -rw------- (600权限)

# 2. 测试公钥获取
curl http://localhost:8765/api/crypto/public-key
# 应返回 { publicKey: "...", expiresAt: "..." }

# 3. 前端保存 API Key，检查传输是加密的
# 浏览器 DevTools Network → PUT /api/settings/llm
# 应看到 api_key_encrypted 字段，内容是 base64 密文

# 4. GET 响应检查
curl http://localhost:8765/api/settings/llm
# apiKey 应返回 "sk-****...****" 遮蔽值

# 5. 检查 git 不会跟踪敏感文件
git status
# 应不显示 trail_private.key、.secret_key、*.sqlite
```
