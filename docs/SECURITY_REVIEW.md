# Trail 代码安全审查报告

**审查日期**：2026-06-13
**审查目的**：代码提交到 Gitee 平台前的敏感信息检查

---

## 一、审查范围

| 模块 | 路径 | 状态 |
|------|------|------|
| Java 后端 | `trail_api/` | ✅ 已审查 |
| React 前端 | `trail_web/` | ✅ 已审查 |
| 项目文档 | `docs/` | ✅ 已审查 |
| 根目录配置 | `.gitignore`, `README.md`, `run.sh` | ✅ 已审查 |

---

## 二、发现的问题

### 中风险问题

| 问题 | 文件位置 | 状态 |
|------|----------|------|
| 硬编码盐值 | `SecretKeyService.java:34` | ✅ 已修复 |
| 硬编码盐值 | `scripts/dump_llm_settings.py` | ✅ 已删除废弃脚本 |

### 低风险问题

| 问题 | 文件位置 | 状态 |
|------|----------|------|
| DEBUG 日志级别 | `application.yml:33` | ✅ 已修复 |
| .gitignore 不完善 | `.gitignore` | ✅ 已增强 |

### 已忽略（风险极低）

| 问题 | 文件位置 | 说明 |
|------|----------|------|
| 本地服务地址硬编码 | `ApiToolExecutor.java`, `OpenApiService.java` | 仅 127.0.0.1，内部地址 |

---

## 三、修复详情

### 1. 盐值配置化

**修改文件**：
- `AppProperties.java` - 添加 `Crypto` 内部 record
- `SecretKeyService.java` - 盐值改为从 `props.crypto().salt()` 读取

**配置方式**：
```yaml
# ~/.trail/config.yaml
trail:
  crypto:
    salt: your_custom_salt_here
```

### 2. 日志级别调整

```yaml
# application.yml
logging:
  level:
    com.trail: INFO  # 原 DEBUG
```

### 3. 废弃脚本删除

删除 `trail_api/scripts/dump_llm_settings.py` —— 旧版 DuckDB 迁移脚本，项目已全面转为 Java + SQLite。

### 4. .gitignore 增强

新增忽略规则：
```
*.pem
*.key
credentials.json
secrets.yaml
secrets.yml
```

---

## 四、安全最佳实践确认

- ✅ 前端 `trail_web/` 无敏感信息泄露
- ✅ 文档 `docs/` 无真实密钥或业务数据
- ✅ `.gitignore` 正确忽略敏感文件
- ✅ API Key 使用 RSA 加密传输 + AES-GCM 加密存储
- ✅ 密钥文件权限设置为 600 (`rw-------`)
- ✅ 无调试打印代码遗留（`System.out.println`）
- ✅ 测试代码无真实凭证
- ✅ 无伪造业务数据（seed/demo 目录不存在）

---

## 五、后续维护建议

1. **定期审查依赖安全**
   ```bash
   cd trail_api && mvn dependency:tree
   cd trail_web && pnpm audit
   ```

2. **提交前敏感信息扫描**
   ```bash
   grep -rn "sk-" --include="*.java" --include="*.ts" --include="*.tsx" .
   grep -rn "password.*=" --include="*.java" --include="*.ts" . | grep -v "type.*password"
   ```

3. **密钥轮换**
   - 如需更换盐值，修改 `config.yaml` 后需重新生成 `.secret_key`
   - 操作步骤：删除旧 `.secret_key` → 重启服务 → 自动派生新密钥

---

## 六、审查结论

**代码可安全提交到 Gitee 平台**。

所有敏感信息泄露风险已修复或确认安全，建议的后续维护措施已记录。