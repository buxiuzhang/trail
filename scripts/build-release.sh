#!/bin/bash
# Trail 跨平台发布包构建脚本
#
# 生成一个包含以下内容的发布包：
#   - trail-api.jar（后端）
#   - static/（前端，嵌入后端）
#   - run.sh / run.bat（启动脚本）
#   - README.txt（使用说明）
#
# 用户只需安装 Java 17+，解压后运行脚本即可。
#
# 用法：
#   sh build-release.sh          # 构建
#   sh build-release.sh clean    # 清理

set -e

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# 版本号
VERSION="0.3.0"

# 目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_ROOT/build/release"
JAR_FILE="$PROJECT_ROOT/trail_api/target/trail-api.jar"
FRONTEND_DIR="$PROJECT_ROOT/trail_web/dist"
OUTPUT_FILE="$PROJECT_ROOT/build/trail-$VERSION.zip"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查环境
check_env() {
    log_info "检查构建环境..."

    if ! command -v java &> /dev/null; then
        log_error "未安装 Java 17+"
        exit 1
    fi

    java_version=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | cut -d'.' -f1)
    if [ "$java_version" -lt 17 ]; then
        log_error "Java 版本过低: $java_version，需要 17+"
        exit 1
    fi
    log_info "Java $java_version ✓"

    if ! command -v mvn &> /dev/null; then
        log_error "未安装 Maven"
        exit 1
    fi
    log_info "Maven ✓"

    if ! command -v pnpm &> /dev/null; then
        log_error "未安装 pnpm"
        exit 1
    fi
    log_info "pnpm ✓"
}

# 构建前端
build_frontend() {
    log_info "构建前端..."

    cd "$PROJECT_ROOT/trail_web"

    if [ ! -d "node_modules" ]; then
        log_info "安装前端依赖..."
        pnpm install
    fi

    pnpm build

    if [ ! -d "dist" ]; then
        log_error "前端构建失败：dist 目录不存在"
        exit 1
    fi

    log_info "前端构建完成 ✓"
}

# 构建后端 JAR
build_jar() {
    log_info "构建后端 JAR..."

    cd "$PROJECT_ROOT/trail_api"
    mvn clean package -DskipTests -q

    if [ ! -f "target/trail-api.jar" ]; then
        log_error "JAR 构建失败"
        exit 1
    fi

    log_info "JAR 构建完成 ✓"
}

# 准备发布包
prepare_release() {
    log_info "准备发布包..."

    rm -rf "$BUILD_DIR"
    mkdir -p "$BUILD_DIR"

    # 复制 JAR
    cp "$JAR_FILE" "$BUILD_DIR/"

    # 复制前端到 static 目录
    mkdir -p "$BUILD_DIR/static"
    cp -r "$FRONTEND_DIR"/* "$BUILD_DIR/static/"

    # 创建启动脚本 (Unix)
    cat > "$BUILD_DIR/run.sh" << 'EOF'
#!/bin/bash
# Trail 启动脚本

# 检查 Java
if ! command -v java &> /dev/null; then
    echo "错误：未安装 Java 17+"
    echo ""
    echo "安装方式："
    echo "  macOS:   brew install openjdk@17"
    echo "  Ubuntu:  sudo apt install openjdk-17-jdk"
    echo "  Windows: choco install openjdk17"
    exit 1
fi

java_version=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | cut -d'.' -f1)
if [ "$java_version" -lt 17 ]; then
    echo "错误：Java 版本过低，需要 17+"
    exit 1
fi

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 启动应用
echo "启动 Trail..."
echo "访问 http://localhost:8765"
echo ""
cd "$SCRIPT_DIR"
java -jar trail-api.jar
EOF
    chmod +x "$BUILD_DIR/run.sh"

    # 创建启动脚本 (Windows)
    cat > "$BUILD_DIR/run.bat" << 'EOF'
@echo off
REM Trail 启动脚本 (Windows)

REM 检查 Java
java -version >nul 2>&1
if errorlevel 1 (
    echo 错误：未安装 Java 17+
    echo.
    echo 安装方式：
    echo   1. 访问 https://adoptium.net/
    echo   2. 下载并安装 JDK 17 或更高版本
    pause
    exit /b 1
)

REM 启动应用
echo 启动 Trail...
echo 访问 http://localhost:8765
echo.
java -jar "%~dp0trail-api.jar"
pause
EOF

    # 创建使用说明
    cat > "$BUILD_DIR/README.txt" << EOF
Trail v$VERSION - 工作日志管理工具
================================

运行要求
--------
Java 17 或更高版本

安装方式
--------
  macOS:   brew install openjdk@17
  Ubuntu:  sudo apt install openjdk-17-jdk
  Windows: choco install openjdk17
           或访问 https://adoptium.net/ 下载

启动方式
--------
  macOS / Linux:
    双击 run.sh 或在终端执行 sh run.sh

  Windows:
    双击 run.bat

首次使用
--------
1. 启动后访问 http://localhost:8765
2. 首次访问会提示配置数据目录
3. 选择一个目录存储数据（如 ~/trail-data）

停止服务
--------
在终端按 Ctrl+C

目录结构
--------
  trail-api.jar  后端程序
  static/         前端资源
  run.sh          macOS/Linux 启动脚本
  run.bat         Windows 启动脚本

更多信息
--------
项目地址: https://gitee.com/bu_xiu/trail
EOF

    log_info "发布包准备完成 ✓"
}

# 打包
create_archive() {
    log_info "创建压缩包..."

    mkdir -p "$(dirname "$OUTPUT_FILE")"
    cd "$(dirname "$BUILD_DIR")"
    zip -r "$OUTPUT_FILE" release
    mv "$OUTPUT_FILE" "$PROJECT_ROOT/build/trail-$VERSION.zip"

    log_info "压缩包创建成功 ✓"
    log_info "输出文件: $PROJECT_ROOT/build/trail-$VERSION.zip"
}

# 清理
clean() {
    log_info "清理构建产物..."
    rm -rf "$PROJECT_ROOT/build"
    rm -rf "$PROJECT_ROOT/trail_api/target"
    rm -rf "$PROJECT_ROOT/trail_web/dist"
    rm -rf "$PROJECT_ROOT/trail_web/node_modules"
    log_info "清理完成 ✓"
}

# 主逻辑
case "$1" in
    clean)
        clean
        ;;
    *)
        echo ""
        echo "Trail v$VERSION 构建脚本"
        echo "========================"
        echo ""
        check_env
        echo ""
        build_frontend
        build_jar
        prepare_release
        create_archive

        echo ""
        echo "=========================================="
        log_info "构建完成！"
        echo ""
        echo "输出文件: build/trail-$VERSION.zip"
        echo ""
        echo "文件内容："
        echo "  - trail-api.jar     后端程序"
        echo "  - static/           前端资源"
        echo "  - run.sh            macOS/Linux 启动脚本"
        echo "  - run.bat           Windows 启动脚本"
        echo "  - README.txt        使用说明"
        echo ""
        echo "用户只需："
        echo "  1. 安装 Java 17+"
        echo "  2. 解压 trail-$VERSION.zip"
        echo "  3. 运行 run.sh 或 run.bat"
        echo "=========================================="
        ;;
esac
