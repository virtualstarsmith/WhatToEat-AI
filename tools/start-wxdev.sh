#!/bin/bash
# ============================================================================
# 微信开发者工具 + noVNC 远程桌面启动脚本（CNB 云原生开发环境）
#
# 用法:
#   ./tools/start-wxdev.sh            前台运行（日志输出到终端）
#   ./tools/start-wxdev.sh --bg       后台运行（日志写入 /tmp/wxdev-*.log）
#
# 访问方式:
#   1) WebIDE 的 PORTS 面板把 6080 端口映射出去（或用环境变量
#      CNB_VSCODE_PROXY_URI 把 {{port}} 换成 6080），得到一个公网 URL
#   2) 浏览器打开  <该公网URL>/vnc.html?autoconnect=1
#   3) VNC 密码: 123456
#   4) 进入桌面后即可操作"微信开发者工具"，首次需扫码登录
# ============================================================================

set -e

# ---------- 可配置项 ----------
WX_ROOT="/opt/apps/io.github.msojocs.wechat-devtools-linux/files/bin"
WX_BIN="${WX_ROOT}/bin"
NWJS="${WX_ROOT}/nwjs"        # nw.js 运行时目录
PKG="${WX_ROOT}/package.nw"   # IDE 应用包
DISPLAY_NUM="${WXDEV_DISPLAY:-0}"
export DISPLAY=":${DISPLAY_NUM}"
SCREEN_SIZE="${WXDEV_SCREEN:-1440x900x24}"
VNC_PORT="${WXDEV_VNC_PORT:-5900}"
NOVNC_PORT="${WXDEV_NOVNC_PORT:-6080}"
VNC_PASSWORD="${WXDEV_VNC_PASSWORD:-123456}"
BG_MODE=0

[ "$1" = "--bg" ] && BG_MODE=1

# ---------- 中文环境 ----------
export LANG=zh_CN.UTF-8
export LC_ALL=zh_CN.UTF-8
export LANGUAGE=zh_CN:zh

# ---------- 清理可能残留的旧进程 ----------
pkill -9 -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true
pkill -9 -f "xfce4-session" 2>/dev/null || true
pkill -9 -f "x11vnc" 2>/dev/null || true
pkill -9 -f "websockify" 2>/dev/null || true
pkill -9 -f "nwjs/nw" 2>/dev/null || true
sleep 1

LOG_DIR="/tmp"
log() { echo "[wxdev $(date +%H:%M:%S)] $*"; }

# ---------- 0. dbus（IDE/nw.js 依赖，否则卡在初始化） ----------
if ! pgrep -x dbus-daemon >/dev/null 2>&1; then
    mkdir -p /run/dbus
    dbus-daemon --system --fork 2>/dev/null || true
fi

# ---------- 1. 虚拟显示 (Xvfb) ----------
log "启动 Xvfb :${DISPLAY_NUM} (${SCREEN_SIZE})"
Xvfb ":${DISPLAY_NUM}" -screen 0 "${SCREEN_SIZE}" +extension RANDR +extension GLX \
    >"${LOG_DIR}/wxdev-xvfb.log" 2>&1 &
sleep 2

# ---------- 2. 桌面环境 (xfce4) ----------
log "启动 xfce4 桌面"
mkdir -p /root/.config/xfce4
# 禁用屏保/电源管理，避免容器内无谓告警
export XDG_SESSION_TYPE=x11
startxfce4 >"${LOG_DIR}/wxdev-xfce.log" 2>&1 &
sleep 3

# ---------- 3. VNC 密码 ----------
mkdir -p /root/.vnc
if [ ! -f /root/.vnc/passwd ]; then
    x11vnc -storepasswd "${VNC_PASSWORD}" /root/.vnc/passwd >/dev/null 2>&1
fi
chmod 600 /root/.vnc/passwd

# ---------- 4. x11vnc ----------
log "启动 x11vnc (RFB ${VNC_PORT})"
x11vnc -display ":${DISPLAY_NUM}" -rfbauth /root/.vnc/passwd \
    -forever -shared -bg \
    -o "${LOG_DIR}/wxdev-x11vnc.log" 2>"${LOG_DIR}/wxdev-x11vnc.err"
sleep 1

# ---------- 5. noVNC / websockify（必须监听 0.0.0.0 才能被 CNB 端口映射访问） ----------
log "启动 noVNC websockify (http 0.0.0.0:${NOVNC_PORT} -> localhost:${VNC_PORT})"
NOVNC_WEB=/usr/share/novnc
[ -d "${NOVNC_WEB}" ] || NOVNC_WEB=/usr/share/novnc
# websockify 第一个位置参数是 web 端口，--web 指定静态目录
websockify "0.0.0.0:${NOVNC_PORT}" "localhost:${VNC_PORT}" --web="${NOVNC_WEB}" \
    >"${LOG_DIR}/wxdev-novnc.log" 2>&1 &
sleep 2

# ---------- 6. 微信开发者工具 ----------
# 关键修复（实测验证）：
#   1) 容器内 Chromium sandbox 阻止进程派生 → 必须加 --no-sandbox --disable-gpu --disable-dev-shm-usage
#   2) 不用 wechat-devtools 启动脚本：它会插 --load-extension 指向可能不存在的 WeappPlugin 目录导致卡死
#   3) --no-sandbox 等参数必须放在 package.nw 之后（nw.js 的参数顺序约定）
#   4) 需设置 APPDATA/USERPROFILE/WECHAT_DEVTOOLS_DIR 等环境变量（原脚本做的事）
log "启动 微信开发者工具 (直接调用 nw, --no-sandbox)"

# 预置 IDE 服务端口开关（CLI 自动化需要）：.ide-status=On
# 否则 wechat-devtools-cli 会报 "IDE service port disabled"
IDE_DATA_DIR="/root/.config/wechat-devtools"
IDE_USER_DIR="${IDE_DATA_DIR}/Default"
mkdir -p "${IDE_USER_DIR}"
if [ ! -f "${IDE_USER_DIR}/.ide-status" ] || [ "$(cat "${IDE_USER_DIR}/.ide-status")" != "On" ]; then
    printf 'On' > "${IDE_USER_DIR}/.ide-status"
fi

cd "${WX_BIN}"
DISPLAY="${DISPLAY}" LANG=zh_CN.UTF-8 HOME=/root \
    WECHAT_DEVTOOLS_DIR="${NWJS}" \
    APPDATA="${IDE_DATA_DIR}" \
    USERPROFILE="${IDE_DATA_DIR}" \
    PATH="${NWJS}:${PATH}" \
    nohup "${NWJS}/nw" "${PKG}" --no-sandbox --disable-gpu --disable-dev-shm-usage \
    >"${LOG_DIR}/wxdev-devtools.log" 2>&1 &

# ---------- 7. 输出访问信息 ----------
sleep 2
PROXY_URI="${CNB_VSCODE_PROXY_URI:-}"
log "============================================================"
log " noVNC 已就绪，容器内 http://localhost:${NOVNC_PORT}/vnc.html"
log " VNC 密码: ${VNC_PASSWORD}"
if [ -n "${PROXY_URI}" ]; then
    PUB_URL="${PROXY_URI//\{\{port\}\}/${NOVNC_PORT}}"
    log " CNB 公网预览地址: ${PUB_URL}/vnc.html?autoconnect=1"
else
    log " 在 WebIDE 的 PORTS 面板映射 ${NOVNC_PORT} 端口即可获得公网地址"
fi
log " 微信开发者工具首次启动需手机扫码登录（登录态保存在 /root/.config/wechat-devtools）"
log "============================================================"

if [ "${BG_MODE}" = "1" ]; then
    log "后台模式：日志见 ${LOG_DIR}/wxdev-*.log"
else
    log "前台模式运行中（Ctrl+C 退出会同时停止桌面栈）"
    # 保持前台，tail 一个日志避免脚本退出
    tail -f "${LOG_DIR}/wxdev-devtools.log" 2>/dev/null || wait
fi
