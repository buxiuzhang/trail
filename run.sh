#!/bin/bash
# Trail 项目启停脚本
# 用法：
#   sh run.sh start          # 启动 api 和 web
#   sh run.sh stop           # 停止 api 和 web
#   sh run.sh start api      # 只启动 api
#   sh run.sh start web      # 只启动 web
#   sh run.sh stop api       # 只停止 api
#   sh run.sh stop web       # 只停止 web
#   sh run.sh status         # 查看状态

set -e

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# 端口
API_PORT=8765
WEB_PORT=5173

# 日志目录
LOG_DIR="$HOME/.trail/logs"
mkdir -p "$LOG_DIR"

# 日志文件
API_LOG="$LOG_DIR/api.log"
WEB_LOG="$LOG_DIR/web.log"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查端口是否被占用
check_port() {
    local port=$1
    if lsof -i :$port -t >/dev/null 2>&1; then
        return 0  # 端口被占用
    else
        return 1  # 端口空闲
    fi
}

# 获取端口对应的 PID
get_pid_by_port() {
    local port=$1
    lsof -i :$port -t 2>/dev/null | head -1
}

# 启动 API 后端
start_api() {
    if check_port $API_PORT; then
        log_warn "API 已在运行 (端口 $API_PORT)"
        return 0
    fi

    log_info "启动 API 后端..."

    # 检查 jar 是否存在
    JAR_FILE="trail_api/target/trail-api.jar"
    if [ ! -f "$JAR_FILE" ]; then
        log_info "编译 API 后端..."
        cd trail_api
        mvn clean package -DskipTests -q
        cd ..
    fi

    # 后台启动
    cd trail_api
    nohup java -jar target/trail-api.jar > "$API_LOG" 2>&1 &
    cd ..

    # 等待启动
    sleep 5

    if check_port $API_PORT; then
        log_info "API 后端已启动 (端口 $API_PORT)"
        log_info "日志: $API_LOG"
    else
        log_error "API 后端启动失败，查看日志: $API_LOG"
        return 1
    fi
}

# 停止 API 后端
stop_api() {
    if ! check_port $API_PORT; then
        log_warn "API 未运行"
        return 0
    fi

    log_info "停止 API 后端..."
    local pid=$(get_pid_by_port $API_PORT)
    if [ -n "$pid" ]; then
        kill $pid 2>/dev/null || true
        sleep 2
        # 强制杀死
        if check_port $API_PORT; then
            kill -9 $(get_pid_by_port $API_PORT) 2>/dev/null || true
        fi
    fi
    log_info "API 后端已停止"
}

# 启动 Web 前端
start_web() {
    if check_port $WEB_PORT; then
        log_warn "Web 已在运行 (端口 $WEB_PORT)"
        return 0
    fi

    log_info "启动 Web 前端..."

    cd trail_web

    # 检查 node_modules
    if [ ! -d "node_modules" ]; then
        log_info "安装依赖..."
        pnpm install
    fi

    # 后台启动
    nohup pnpm dev > "$WEB_LOG" 2>&1 &
    cd ..

    # 等待启动
    sleep 5

    if check_port $WEB_PORT; then
        log_info "Web 前端已启动 (端口 $WEB_PORT)"
        log_info "访问: http://localhost:$WEB_PORT"
        log_info "日志: $WEB_LOG"
    else
        log_error "Web 前端启动失败，查看日志: $WEB_LOG"
        return 1
    fi
}

# 停止 Web 前端
stop_web() {
    if ! check_port $WEB_PORT; then
        log_warn "Web 未运行"
        return 0
    fi

    log_info "停止 Web 前端..."
    local pid=$(get_pid_by_port $WEB_PORT)
    if [ -n "$pid" ]; then
        kill $pid 2>/dev/null || true
        sleep 2
        # 强制杀死
        if check_port $WEB_PORT; then
            kill -9 $(get_pid_by_port $WEB_PORT) 2>/dev/null || true
        fi
    fi
    log_info "Web 前端已停止"
}

# 查看状态
show_status() {
    echo ""
    echo "Trail 服务状态"
    echo "==============="

    if check_port $API_PORT; then
        echo -e "API 后端:  ${GREEN}运行中${NC} (端口 $API_PORT)"
    else
        echo -e "API 后端:  ${RED}未运行${NC}"
    fi

    if check_port $WEB_PORT; then
        echo -e "Web 前端: ${GREEN}运行中${NC} (端口 $WEB_PORT)"
    else
        echo -e "Web 前端: ${RED}未运行${NC}"
    fi

    echo ""
    echo "日志文件:"
    echo "  API: $API_LOG"
    echo "  Web: $WEB_LOG"
    echo ""
}

# 显示帮助
show_help() {
    echo ""
    echo "Trail 启停脚本"
    echo ""
    echo "用法:"
    echo "  sh run.sh start          # 启动 api 和 web"
    echo "  sh run.sh stop           # 停止 api 和 web"
    echo "  sh run.sh start api      # 只启动 api"
    echo "  sh run.sh start web      # 只启动 web"
    echo "  sh run.sh stop api       # 只停止 api"
    echo "  sh run.sh stop web       # 只停止 web"
    echo "  sh run.sh status         # 查看状态"
    echo ""
}

# 主逻辑
case "$1" in
    start)
        case "$2" in
            api)
                start_api
                ;;
            web)
                start_web
                ;;
            "")
                start_api
                start_web
                ;;
            *)
                log_error "未知参数: $2"
                show_help
                exit 1
                ;;
        esac
        ;;
    stop)
        case "$2" in
            api)
                stop_api
                ;;
            web)
                stop_web
                ;;
            "")
                stop_api
                stop_web
                ;;
            *)
                log_error "未知参数: $2"
                show_help
                exit 1
                ;;
        esac
        ;;
    status)
        show_status
        ;;
    -h|--help|help)
        show_help
        ;;
    "")
        show_help
        ;;
    *)
        log_error "未知命令: $1"
        show_help
        exit 1
        ;;
esac