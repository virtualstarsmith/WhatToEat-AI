#!/bin/bash
# ============================================================================
# 微信小程序 CLI 自动化预览脚本
#
# 依赖：
#   1. 微信开发者工具已启动（GUI 模式，带 --no-sandbox），且已完成扫码登录
#      （登录态在 /root/.config/wechat-devtools，首次必须人工扫码一次）
#   2. IDE 已开启服务端口：/root/.config/wechat-devtools/Default/.ide-status = On
#      （start-wxdev.sh 已自动预置）
#   3. IDE 启动后会写出 /root/.config/wechat-devtools/Default/.ide（HTTP 端口号）
#
# 用法：
#   ./tools/wx-cli.sh status      # 查看 IDE/登录/端口状态
#   ./tools/wx-cli.sh preview     # 生成预览二维码（终端显示）
#   ./tools/wx-cli.sh preview-img # 生成预览二维码图片到 output/preview-qr.png
#   ./tools/wx-cli.sh auto-preview# 自动预览（推送已编译代码到手机）
#   ./tools/wx-cli.sh upload "1.0.0" "首次发布"  # 上传小程序
#   ./tools/wx-cli.sh build-npm   # 构建 npm
#
# 环境变量：
#   WX_PROJECT   项目路径，默认 /workspace
#   WX_PORT      IDE HTTP 端口，默认自动读取 .ide 文件
# ============================================================================

set -e

WX_BIN="/opt/apps/io.github.msojocs.wechat-devtools-linux/files/bin/bin"
CLI="${WX_BIN}/wechat-devtools-cli"
PROJECT="${WX_PROJECT:-/workspace}"
IDE_DEFAULT_DIR="/root/.config/wechat-devtools/Default"
IDE_FILE="${IDE_DEFAULT_DIR}/.ide"
STATUS_FILE="${IDE_DEFAULT_DIR}/.ide-status"

export DISPLAY="${DISPLAY:-:0}"
export LANG=zh_CN.UTF-8

# 读取 IDE HTTP 端口
get_port() {
    if [ -n "${WX_PORT}" ]; then echo "${WX_PORT}"; return; fi
    if [ -f "${IDE_FILE}" ]; then cat "${IDE_FILE}"; return; fi
    echo "3799"  # 默认端口
}

cmd_status() {
    echo "=== 微信开发者工具 CLI 状态 ==="
    # IDE 进程
    NW_COUNT=$(pgrep -cf "nwjs/nw" 2>/dev/null || echo 0)
    echo "IDE 进程数: ${NW_COUNT}  $([ "${NW_COUNT}" -gt 0 ] && echo '✅ 运行中' || echo '❌ 未启动')"
    # 服务端口开关
    if [ -f "${STATUS_FILE}" ]; then
        echo "服务端口开关: $(cat ${STATUS_FILE}) $([ "$(cat ${STATUS_FILE})" = "On" ] && echo '✅' || echo '❌ 请设为 On')"
    else
        echo "服务端口开关: ❌ 缺失（运行 start-wxdev.sh 会自动创建）"
    fi
    # IDE HTTP 端口
    if [ -f "${IDE_FILE}" ]; then
        PORT=$(cat "${IDE_FILE}")
        echo "IDE HTTP 端口: ${PORT} ✅（IDE 已就绪）"
    else
        echo "IDE HTTP 端口: ❌ .ide 文件不存在（IDE 未完成登录/初始化）"
        echo "  → 请在 noVNC 浏览器里完成扫码登录，登录后 IDE 会写出此文件"
        return 1
    fi
    # 登录状态
    echo "--- 登录状态 ---"
    "${CLI}" islogin --port "${PORT}" --lang zh 2>&1 | grep -vE '^\s*$' | tail -5 || true
}

# 通用：确保 IDE 就绪
ensure_ready() {
    if [ ! -f "${IDE_FILE}" ]; then
        echo "❌ IDE 未就绪：${IDE_FILE} 不存在"
        echo "   请先在 noVNC 浏览器完成扫码登录。"
        echo "   noVNC: 用 start-wxdev.sh 启动后映射 6080 端口访问。"
        return 1
    fi
    PORT=$(get_port)
    echo "使用 IDE 端口: ${PORT}"
}

cmd_preview() {
    ensure_ready
    PORT=$(get_port)
    echo "=== 生成预览二维码（终端） ==="
    "${CLI}" preview --project "${PROJECT}" --port "${PORT}" -f terminal --lang zh --disable-gpu 2>&1 \
        | grep -vE '^\s*$'
}

cmd_preview_img() {
    ensure_ready
    PORT=$(get_port)
    mkdir -p "${PROJECT}/output"
    OUT="${PROJECT}/output/preview-qr.png"
    echo "=== 生成预览二维码图片 -> ${OUT} ==="
    "${CLI}" preview --project "${PROJECT}" --port "${PORT}" -f image -o "${OUT}" --lang zh --disable-gpu 2>&1 \
        | grep -vE '^\s*$'
    [ -f "${OUT}" ] && echo "✅ 二维码已保存: ${OUT}" || echo "❌ 生成失败，检查登录状态"
}

cmd_auto_preview() {
    ensure_ready
    PORT=$(get_port)
    echo "=== 自动预览（推送已编译代码到手机微信） ==="
    "${CLI}" auto-preview --project "${PROJECT}" --port "${PORT}" --lang zh --disable-gpu 2>&1 \
        | grep -vE '^\s*$'
}

cmd_upload() {
    ensure_ready
    PORT=$(get_port)
    VERSION="${1:?用法: wx-cli.sh upload <版本号> <描述>}"
    DESC="${2:?用法: wx-cli.sh upload <版本号> <描述>}"
    echo "=== 上传小程序 版本=${VERSION} 描述=${DESC} ==="
    "${CLI}" upload --project "${PROJECT}" --port "${PORT}" -v "${VERSION}" -d "${DESC}" --lang zh --disable-gpu 2>&1 \
        | grep -vE '^\s*$'
}

cmd_build_npm() {
    ensure_ready
    PORT=$(get_port)
    echo "=== 构建 NPM ==="
    "${CLI}" build-npm --project "${PROJECT}" --port "${PORT}" --lang zh --disable-gpu 2>&1 \
        | grep -vE '^\s*$'
}

case "${1:-}" in
    status)        cmd_status ;;
    preview)       cmd_preview ;;
    preview-img)   cmd_preview_img ;;
    auto-preview)  cmd_auto_preview ;;
    upload)        shift; cmd_upload "$@" ;;
    build-npm)     cmd_build_npm ;;
    *) echo "用法: $0 {status|preview|preview-img|auto-preview|upload <ver> <desc>|build-npm}"; exit 1 ;;
esac
