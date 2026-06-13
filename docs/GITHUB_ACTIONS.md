# GitHub Actions 自动构建配置说明

## 配置已完成

已添加以下文件：

```
.github/workflows/release.yml  # GitHub Actions 工作流配置
```

## 使用步骤

### 1. 创建 GitHub 仓库

```bash
# 在 GitHub 上创建新仓库（可以私有）
# 然后添加远程仓库
git remote add github https://github.com/你的用户名/trail.git
```

### 2. 推送代码

```bash
# 推送代码到 GitHub
git push github main
```

### 3. 触发构建

两种方式：

**方式一：推送 Tag（推荐）**
```bash
# 创建并推送 tag
git tag v0.3.0
git push github v0.3.0
```

**方式二：手动触发**
1. 打开 GitHub 仓库
2. 点击 Actions 标签
3. 选择 "Build and Release" 工作流
4. 点击 "Run workflow"
5. 输入版本号（如 0.3.0）

### 4. 下载安装包

构建完成后（约 10-15 分钟）：

1. 打开 GitHub 仓库
2. 点击右侧 "Releases"
3. 下载对应平台的安装包

## 构建产物

| 文件 | 平台 | 大小 | 说明 |
|------|------|------|------|
| `Trail-x.x.x.exe` | Windows | ~60MB | 安装包，无需 Java |
| `Trail-x.x.x.dmg` | macOS | ~60MB | 安装包，无需 Java |
| `trail-x.x.x-jar.zip` | 跨平台 | ~45MB | 需安装 Java 17 |

## 工作流说明

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ build-windows   │     │   build-macos   │     │    build-jar    │
│ (windows-latest)│     │  (macos-latest) │     │ (ubuntu-latest) │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │     release     │
                        │  创建 GitHub    │
                        │    Release      │
                        └─────────────────┘
```

## 本地测试（可选）

如需本地测试构建：

```bash
# 测试后端构建
cd trail_api
mvn clean package -DskipTests

# 测试前端构建
cd trail_web
pnpm install
pnpm build

# 测试 jpackage（需要 JDK 17+）
jpackage --name Trail --type app-image --input trail_api/target \
  --main-jar trail-api.jar --dest output
```

## 常见问题

### Q: 构建失败怎么办？

查看 Actions 日志，常见原因：
- Maven 依赖下载失败（重试即可）
- pnpm install 失败（检查 package.json）

### Q: 如何更新版本号？

版本号从 tag 自动获取，格式 `v0.3.0`。

### Q: 能否只构建某个平台？

可以，在 Actions 页面选择对应 job 手动运行。

### Q: macOS 构建很慢？

正常，macOS runner 初始化较慢，大约需要 5-10 分钟。
