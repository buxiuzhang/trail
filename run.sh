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

    # 检查源文件是否有更新（比 jar 新）
    NEED_BUILD=false
    if [ ! -f "$JAR_FILE" ]; then
        NEED_BUILD=true
    else
        # 检查是否有比 jar 更新的源文件
        if find trail_api/src -name "*.java" -newer "$JAR_FILE" | grep -q .; then
            NEED_BUILD=true
        fi
    fi

    if [ "$NEED_BUILD" = true ]; then
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

BUILD_DIR="$(cd "$(dirname "$0")" && pwd)/build"

do_build() {
    mkdir -p "$BUILD_DIR"

    log_info "编译后端..."
    cd "$(dirname "$0")/trail_api"
    mvn clean package -DskipTests -q
    cp target/trail-api.jar "$BUILD_DIR/trail-api.jar"
    cd - >/dev/null
    log_info "后端打包完成: $BUILD_DIR/trail-api.jar"

    log_info "编译前端..."
    cd "$(dirname "$0")/trail_web"
    pnpm install --frozen-lockfile --silent
    pnpm exec vite build
    cd - >/dev/null
    log_info "前端打包完成: $BUILD_DIR/web"

    # 生成 server.js（Node.js 静态服务 + /api 代理，纯内置模块）
    cat > "$BUILD_DIR/server.js" << 'SERVERJS'
#!/usr/bin/env node
const http = require('http')
const fs   = require('fs')
const path = require('path')

const WEB_DIR  = path.join(__dirname, 'web')
const WEB_PORT = parseInt(process.env.WEB_PORT || '5173', 10)
const API_PORT = parseInt(process.env.API_PORT || '8765', 10)
const API_HOST = '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
}

function proxyToApi(req, res) {
  const opts = {
    hostname: API_HOST, port: API_PORT,
    path: req.url, method: req.method,
    headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
  }
  const proxy = http.request(opts, (r) => {
    const headers = { ...r.headers }
    const ct = headers['content-type'] || ''
    if (ct.includes('application/json') && !ct.includes('charset')) {
      headers['content-type'] = ct + '; charset=utf-8'
    }
    res.writeHead(r.statusCode, headers)
    r.pipe(res)
  })
  proxy.on('error', () => res.writeHead(502).end('Bad Gateway'))
  req.pipe(proxy)
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api')) return proxyToApi(req, res)
  let file = path.join(WEB_DIR, req.url.split('?')[0])
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIR, 'index.html')
  const mime = MIME[path.extname(file)] || 'application/octet-stream'
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not Found'); return }
    res.writeHead(200, { 'Content-Type': mime }); res.end(data)
  })
}).listen(WEB_PORT, '127.0.0.1', () => console.log(`Trail Web  http://localhost:${WEB_PORT}`))
SERVERJS

    # 生成 build/app.sh（给同事用的自包含启停脚本）
    cat > "$BUILD_DIR/app.sh" << 'APPSH'
#!/bin/bash
# Trail 启停脚本
# 用法: sh app.sh start|stop|status [api|web]
#
# 可选环境变量：
#   TRAIL_JAVA_HOME  指定 Java 17+ 的 JAVA_HOME，未设置则使用系统 java

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
API_PORT=8765; WEB_PORT=5173
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_JAR="$SCRIPT_DIR/trail-api.jar"
LOG_DIR="$HOME/.trail/logs"; mkdir -p "$LOG_DIR"
API_LOG="$LOG_DIR/api.log"; WEB_LOG="$LOG_DIR/web.log"

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
check_port() { lsof -i :"$1" -t >/dev/null 2>&1; }
get_pid()    { lsof -i :"$1" -t 2>/dev/null | head -1; }

resolve_java() {
    if [ -n "$TRAIL_JAVA_HOME" ]; then echo "$TRAIL_JAVA_HOME/bin/java"
    else echo "java"; fi
}

check_env() {
    local ok=true
    local java_bin; java_bin=$(resolve_java)

    if ! command -v "$java_bin" >/dev/null 2>&1; then
        log_error "未找到 Java：$java_bin"
        log_error "请安装 Java 17+，或设置 TRAIL_JAVA_HOME 指向 JDK 目录"
        log_error "示例: export TRAIL_JAVA_HOME=/usr/local/jdk-17"
        ok=false
    else
        local ver; ver=$("$java_bin" -version 2>&1 | head -1)
        local major
        major=$("$java_bin" -version 2>&1 | grep -oE '"[0-9]+' | head -1 | tr -d '"')
        [ "$major" = "1" ] && major=$("$java_bin" -version 2>&1 | grep -oE '"1\.[0-9]+' | head -1 | grep -oE '\.[0-9]+' | tr -d '.')
        if [ "$major" -lt 17 ] 2>/dev/null; then
            log_error "Java 版本过低：$ver"
            log_error "Trail 需要 Java 17+，当前为 Java $major"
            log_error "请设置 TRAIL_JAVA_HOME 指向 Java 17+ 的 JDK 目录"
            log_error "示例: export TRAIL_JAVA_HOME=/usr/local/jdk-17"
            ok=false
        else
            log_info "Java 版本: $ver ✓"
        fi
    fi

    if ! command -v node >/dev/null 2>&1; then
        log_error "未找到 Node.js，请安装 Node.js 16+"
        log_error "下载地址: https://nodejs.org"
        ok=false
    else
        log_info "Node.js 版本: $(node --version) ✓"
    fi

    [ "$ok" = true ]
}

start_api() {
    if check_port $API_PORT; then log_warn "API 已在运行 (端口 $API_PORT)"; return 0; fi
    local java_bin; java_bin=$(resolve_java)
    log_info "启动 API 后端..."
    nohup "$java_bin" -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -jar "$API_JAR" > "$API_LOG" 2>&1 &
    sleep 12
    if check_port $API_PORT; then
        log_info "API 已启动 (端口 $API_PORT)，日志: $API_LOG"
    else
        log_error "API 启动失败，查看日志: $API_LOG"; return 1
    fi
}

stop_api() {
    if ! check_port $API_PORT; then log_warn "API 未运行"; return 0; fi
    log_info "停止 API..."; local pid; pid=$(get_pid $API_PORT)
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; sleep 2
    check_port $API_PORT && kill -9 "$(get_pid $API_PORT)" 2>/dev/null || true
    log_info "API 已停止"
}

start_web() {
    if check_port $WEB_PORT; then log_warn "Web 已在运行 (端口 $WEB_PORT)"; return 0; fi
    log_info "启动 Web 前端..."
    nohup node "$SCRIPT_DIR/server.js" > "$WEB_LOG" 2>&1 &
    sleep 3
    if check_port $WEB_PORT; then
        log_info "Web 已启动，访问: http://localhost:$WEB_PORT"
    else
        log_error "Web 启动失败，查看日志: $WEB_LOG"; return 1
    fi
}

stop_web() {
    if ! check_port $WEB_PORT; then log_warn "Web 未运行"; return 0; fi
    log_info "停止 Web..."; local pid; pid=$(get_pid $WEB_PORT)
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; sleep 2
    check_port $WEB_PORT && kill -9 "$(get_pid $WEB_PORT)" 2>/dev/null || true
    log_info "Web 已停止"
}

show_status() {
    echo ""; echo "Trail 服务状态"; echo "==============="
    if check_port $API_PORT; then echo -e "API 后端:  ${GREEN}运行中${NC} (端口 $API_PORT)"
    else echo -e "API 后端:  ${RED}未运行${NC}"; fi
    if check_port $WEB_PORT; then echo -e "Web 前端: ${GREEN}运行中${NC}  http://localhost:$WEB_PORT"
    else echo -e "Web 前端: ${RED}未运行${NC}"; fi
    echo ""; echo "日志: $LOG_DIR"; echo ""
    local java_bin; java_bin=$(resolve_java)
    if command -v "$java_bin" >/dev/null 2>&1; then
        echo "Java:     $("$java_bin" -version 2>&1 | head -1)"
        echo "          (如需切换，设置 TRAIL_JAVA_HOME)"
    fi
    echo ""
}

case "$1" in
    start)
        check_env || exit 1
        case "$2" in api) start_api;; web) start_web;; "") start_api && start_web;; *) log_error "未知参数: $2"; exit 1;; esac;;
    stop)
        case "$2" in api) stop_api;; web) stop_web;; "") stop_api && stop_web;; *) log_error "未知参数: $2"; exit 1;; esac;;
    status) show_status;;
    *)
        echo "用法: sh app.sh start|stop|status [api|web]"
        echo ""
        echo "可选环境变量:"
        echo "  TRAIL_JAVA_HOME  指定 Java 17+ 的 JDK 目录"
        echo "  示例: TRAIL_JAVA_HOME=/usr/local/jdk-17 sh app.sh start"
        ;;
esac
APPSH
    chmod +x "$BUILD_DIR/app.sh"

    echo ""
    log_info "打包完成 → $BUILD_DIR"
    echo ""
    echo "  trail-api.jar   后端"
    echo "  web/            前端静态文件"
    echo "  server.js       前端服务（Node.js 内置，无需安装依赖）"
    echo "  app.sh          启停脚本"
    echo ""
    echo "将 build/ 目录发给同事，执行: sh app.sh start"
}

# 显示帮助
show_help() {
    echo ""
    echo "Trail 启停脚本"
    echo ""
    echo "用法:"
    echo "  sh run.sh build          # 打包前后端到 build/"
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
    build)
        do_build
        ;;
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