#!/bin/bash
# Trail Windows 安装包构建脚本
#
# 前置条件：
#   1. macOS/Linux 环境（用于交叉编译）
#   2. 安装 jpackage：JDK 17+ 自带
#   3. 安装 WiX Toolset（Windows 安装包需要）：brew install wix
#
# 用法：
#   sh build-windows.sh          # 构建并在 build/ 输出
#   sh build-windows.sh clean     # 清理构建产物

set -e

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# 版本号
VERSION="0.3.0"

# 目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_ROOT/build"
JAR_FILE="$PROJECT_ROOT/trail_api/target/trail-api.jar"
FRONTEND_DIR="$PROJECT_ROOT/trail_web/dist"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查环境
check_env() {
    log_info "检查构建环境..."

    # 检查 Java
    if ! command -v java &> /dev/null; then
        log_error "未安装 Java 17+"
        exit 1
    fi

    local java_version=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | cut -d'.' -f1)
    if [ "$java_version" -lt 17 ]; then
        log_error "Java 版本过低: $version，需要 17+"
        exit 1
    fi
    log_info "Java $java_version ✓"

    # 检查 jpackage
    if ! command -v jpackage &> /dev/null; then
        log_error "未找到 jpackage，请确保 JDK 17+ 已正确安装"
        exit 1
    fi
    log_info "jpackage ✓"
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

    if [ -f "target/trail-api.jar" ]; then
        log_info "JAR 已存在，跳过构建"
        return
    fi

    mvn clean package -DskipTests -q

    if [ ! -f "target/trail-api.jar" ]; then
        log_error "JAR 构建失败"
        exit 1
    fi

    log_info "JAR 构建完成 ✓"
}

# 准备打包目录
prepare_bundle() {
    log_info "准备打包目录..."

    rm -rf "$BUILD_DIR"
    mkdir -p "$BUILD_DIR/app"
    mkdir -p "$BUILD_DIR/runtime"

    # 复制 JAR
    cp "$JAR_FILE" "$BUILD_DIR/app/"

    # 复制前端 dist 到 JAR 同级目录（Spring Boot 会自动挂载）
    cp -r "$FRONTEND_DIR" "$BUILD_DIR/app/static"

    log_info "打包目录准备完成 ✓"
}

# 使用 jpackage 创建 Windows 安装包
create_windows_installer() {
    log_info "创建 Windows 安装包..."

    cd "$BUILD_DIR"

    # 创建 icon（可选）
    # 如果有 icon 文件，添加 --icon trail.ico

    jpackage \
        --name "Trail" \
        --app-version "$VERSION" \
        --description "Trail 工作日志管理工具" \
        --vendor "Trail Team" \
        --type exe \
        --input app \
        --main-jar trail-api.jar \
        --main-class com.trail.TrailApiApplication \
        --java-options "-Xmx512m" \
        --java-options "-Dfile.encoding=UTF-8" \
        --win-console \
        --win-dir-chooser \
        --win-menu \
        --win-shortcut \
        --dest "$BUILD_DIR/output"

    if [ -f "$BUILD_DIR/output/Trail-$VERSION.exe" ]; then
        log_info "Windows 安装包创建成功 ✓"
        log_info "输出文件: $BUILD_DIR/output/Trail-$VERSION.exe"
    else
        log_error "安装包创建失败"
        exit 1
    fi
}

# 清理
clean() {
    log_info "清理构建产物..."
    rm -rf "$BUILD_DIR"
    rm -rf "$PROJECT_ROOT/trail_api/target"
    rm -rf "$PROJECT_ROOT/trail_web/dist"
    log_info "清理完成 ✓"
}

# 主逻辑
case "$1" in
    clean)
        clean
        ;;
    *)
        check_env
        build_frontend
        build_jar
        prepare_bundle
        create_windows_installer

        echo ""
        echo "=========================================="
        log_info "构建完成！"
        echo ""
        echo "输出文件: $BUILD_DIR/output/Trail-$VERSION.exe"
        echo ""
        echo "使用说明："
        echo "  1. 将 Trail-$VERSION.exe 发送给用户"
        echo "  2. 用户双击安装，选择安装目录"
        echo "  3. 安装完成后，从开始菜单启动 Trail"
        echo "=========================================="
        ;;
esac
