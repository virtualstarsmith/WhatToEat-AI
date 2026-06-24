# =============================================================================
# 微信开发者工具 (Linux 版) + noVNC 远程桌面 — CNB 云原生开发环境镜像
#
# 作用: 让你在 CNB 云端像本地一样启动微信开发者工具、用浏览器预览小程序。
#
# 验证基础: debian:trixie + wechat-web-devtools-linux v2.01.2510290-2
# 构建后镜像约 2.5GB，建议构建一次推到镜像仓库复用。
# =============================================================================

FROM debian:trixie

# 避免交互式提问卡住构建
ENV DEBIAN_FRONTEND=noninteractive

# ---------- 锁定微信开发者工具版本（升级时改这里） ----------
ARG WXDEV_VERSION=2.01.2510290-2
ARG WXDEV_BASE="https://github.com/msojocs/wechat-web-devtools-linux/releases/download/v${WXDEV_VERSION}"
ARG WXDEV_DEB="io.github.msojocs.wechat-devtools-linux_${WXDEV_VERSION}_amd64.deb"

# ---------- 系统基础：虚拟显示 + VNC + noVNC + xfce 桌面 + 中文字体/locale ----------
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl wget gnupg \
        # 虚拟显示与 X 工具
        xvfb x11-xserver-utils x11-utils \
        # VNC
        x11vnc \
        # noVNC web 客户端
        novnc websockify \
        # 轻量桌面 + dbus（IDE/nw.js 依赖系统 dbus，否则卡在初始化）
        xfce4 xfce4-terminal dbus dbus-x11 xauth \
        # nw.js / chromium 运行依赖（验证发现缺这几项）
        libnss3 libasound2t64 libgbm1 libxkbcommon0 libgtk-3-0 \
        libnotify4 libxtst6 libxss1 libatk-bridge2.0-0 \
        # 中文字体 + locale + 截图工具
        fonts-noto-cjk fonts-wqy-microhei locales imagemagick \
        net-tools procps \
    && sed -i 's/# *zh_CN.UTF-8/zh_CN.UTF-8/' /etc/locale.gen \
    && sed -i 's/# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen \
    && locale-gen \
    # 生成 /etc/machine-id（IDE/Chromium 依赖，空值会导致初始化失败）
    && (test -s /etc/machine-id || (python3 -c "import uuid;print(uuid.uuid4().hex)" > /etc/machine-id)) \
    && mkdir -p /var/lib/dbus && cp /etc/machine-id /var/lib/dbus/machine-id \
    && rm -rf /var/lib/apt/lists/*

# 中文环境
ENV LANG=zh_CN.UTF-8
ENV LC_ALL=zh_CN.UTF-8
ENV LANGUAGE=zh_CN:zh

# ---------- 安装微信开发者工具 (Linux 版, 基于 nw.js) ----------
RUN mkdir -p /opt/wxdev \
    && curl -fL --retry 3 -o /opt/wxdev/wxdev.deb "${WXDEV_BASE}/${WXDEV_DEB}" \
    && apt-get update \
    && apt-get install -y --no-install-recommends /opt/wxdev/wxdev.deb \
    && rm -rf /var/lib/apt/lists/* /opt/wxdev/wxdev.deb

# 软链接到 PATH，方便命令行调用
RUN ln -sf /opt/apps/io.github.msojocs.wechat-devtools-linux/files/bin/bin/wechat-devtools /usr/local/bin/wechat-devtools \
    && ln -sf /opt/apps/io.github.msojocs.wechat-devtools-linux/files/bin/bin/wechat-devtools-cli /usr/local/bin/wechat-devtools-cli

# ---------- 复制启动脚本 ----------
COPY tools/start-wxdev.sh /usr/local/bin/start-wxdev.sh
RUN chmod +x /usr/local/bin/start-wxdev.sh

# 暴露 noVNC web 端口（CNB 端口映射会用到）
EXPOSE 6080

# 默认进入 bash；桌面栈由 .cnb.yml 的 stages 或手动 start-wxdev.sh 拉起
CMD ["/bin/bash"]
