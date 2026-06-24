# WhatToEat-AI

微信小程序原生开发模板，用于启动“今天吃什么”推荐类应用。

## 使用方式

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择当前目录：`D:\aiproject\aiproject\WhatToEat-AI`。
4. AppID 可先使用测试号或导入配置中的 `touristappid`，后续替换为正式小程序 AppID。

## 项目结构

```text
.
├── app.js
├── app.json
├── app.wxss
├── project.config.json
├── sitemap.json
├── pages/
│   ├── index/
│   └── logs/
└── utils/
    └── util.js
```

## 下一步

* 在微信开发者工具中确认首页和日志页可正常预览。
* 将 `project.config.json` 中的 `appid` 替换为正式 AppID。
* 后续接入真实推荐接口时，优先新增 `services/` 目录封装请求逻辑。

# 云端开发环境（CNB 上直接用微信开发者工具）

本仓库已配置 CNB 云原生开发环境，内置微信开发者工具（Linux 版）+ noVNC 远程桌面，
**无需本地安装任何工具**，在浏览器里即可启动开发者工具、用模拟器预览小程序。

## 相关文件

* `.ide/Dockerfile` — 开发环境镜像定义（微信开发者工具 + Xvfb + x11vnc + noVNC + xfce 桌面）
* `.cnb.yml` — CNB 配置：①构建流水线把镜像推到制品库 ②开发环境启动时自动拉起桌面栈
* `tools/start-wxdev.sh` — 桌面栈启动脚本（手动重启时也可用）

## 构建并推送镜像到 CNB 制品库

`.cnb.yml` 已配置两条构建流水线（已通过官方 schema 校验）：

| 触发方式 | 镜像标签 | 用途 |
|---|---|---|
| 推送到 `main` 分支 | `:latest` + `:<commit短SHA>` | 日常更新，开发环境默认用 `latest` |
| 打 Tag（如 `v1.0.0`） | `:v1.0.0`（并刷新 `:latest`） | 版本化发布 |

* 镜像地址：`docker.cnb.cool/virtualstarsmith/whateat-ai:<tag>`
  （流水线用 `${CNB_DOCKER_REGISTRY}/${CNB_REPO_SLUG_LOWERCASE}` 自动拼出，无需手写）
* `services: [docker]` 会自动 `docker login` 到 CNB 制品库，无需额外配置凭证
* 首次推送到 main 即触发构建；构建完成后开发环境（`vscode` 段）会直接拉取 `:latest`，秒级启动

**首次使用流程**：推送代码到 main → 等「云原生构建」流水线跑完（产出 `:latest` 镜像）→
再打开「云原生开发」即可快速拉起。若构建尚未完成就打开开发环境，可临时把 `.cnb.yml`
里 `vscode` 段的 `image:` 注释掉、启用 `build: .ide/Dockerfile` 就地构建。

## 使用步骤

1. 在 CNB 上打开本仓库，点击「云原生开发」。环境会自动构建镜像并启动，
   进入 WebIDE 后桌面栈已在后台运行。
2. 在 WebIDE 底部找到 **PORTS** 面板，添加端口映射 `6080`（若没有该面板，
   可用环境变量 `CNB_VSCODE_PROXY_URI`，把其中的 `{{port}}` 替换为 `6080`）。
3. 浏览器打开得到的公网 URL：`<公网地址>/vnc.html?autoconnect=1`
4. VNC 密码：`123456`
5. 进入桌面后即可看到「微信开发者工具」，首次需用手机微信扫码登录
   （登录态保存在 `/root/.config/wechat-devtools`，环境重启后无需重新扫码）。
6. 在开发者工具里「导入项目」，目录选 `/workspace`，即可用模拟器预览本小程序。

## 预览小程序的三种方式

* **模拟器**（推荐）：noVNC 桌面里开发者工具自带的模拟器，所见即所得。
* **真机预览**：开发者工具「预览」按钮生成二维码，手机微信扫码打开。
* **自动化**：命令行 `wechat-devtools-cli`（已加入 PATH），可用于 CI 自动编译/预览。

## CLI 自动化预览（wechat-devtools-cli）

`tools/wx-cli.sh` 封装了常用 CLI 操作。**前提：IDE 已启动且完成扫码登录**
（首次必须在 noVNC 浏览器里人工扫码一次，登录态持久化在 `/root/.config/wechat-devtools`）。

```bash
# 查看状态（IDE 进程/服务端口/登录态）
./tools/wx-cli.sh status

# 生成预览二维码（终端显示）
./tools/wx-cli.sh preview

# 生成预览二维码图片到 output/preview-qr.png
./tools/wx-cli.sh preview-img

# 自动预览（推送已编译代码到手机微信）
./tools/wx-cli.sh auto-preview

# 上传小程序
./tools/wx-cli.sh upload 1.0.0 "首次发布"

# 构建 npm
./tools/wx-cli.sh build-npm
```

CLI 与 IDE 通过 HTTP 端口通信（默认 3799，自动读取 `.ide` 文件）。
关键配置（`start-wxdev.sh` 已自动处理）：
* `.ide-status` 内容为 `On` — 开启服务端口开关（否则 CLI 报 "port disabled"）
* IDE 启动加 `--no-sandbox --disable-gpu` — 容器内 Chromium sandbox 会阻止进程派生
* dbus + `/etc/machine-id` — IDE 初始化依赖

## 手动重启桌面栈

```bash
start-wxdev.sh --bg        # 后台启动
start-wxdev.sh             # 前台启动（日志直接输出）
```

日志位于 `/tmp/wxdev-*.log`。升级微信开发者工具版本时，修改 `.ide/Dockerfile`
顶部的 `WXDEV_VERSION` 后重新打开云原生开发即可。


> 说明：当前验证基于 wechat-web-devtools-linux `v2.01.2510290-2`（社区维护的 Linux 原生版，
> 基于 nw.js，非 Wine）。镜像约 2.5GB，建议构建一次推送到制品库复用以加快启动。

