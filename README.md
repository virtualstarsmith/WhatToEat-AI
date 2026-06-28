# WhatToEat-AI

微信小程序原生开发模板，用于启动"今天吃什么"推荐类应用。

## 使用方式

1. 打开微信开发者工具。
2. 选择"导入项目"。
3. 项目目录选择当前目录。
4. AppID 可先使用测试号或导入配置中的 `touristappid`，后续替换为正式小程序 AppID。

## 云端开发环境

本项目使用 [wechat-dev-tools-cnb](https://cnb.cool/virtualstarsmith/wechat-dev-tools-cnb) 提供的 CNB 云原生开发环境镜像，
内置微信开发者工具（Linux 版）+ noVNC 远程桌面，**无需本地安装任何工具**即可在浏览器里预览小程序。

使用步骤：
1. 在 CNB 上打开本仓库，点击「云原生开发」。
2. 在 WebIDE 底部 PORTS 面板映射 `6080` 端口，得到公网 URL。
3. 浏览器打开 `<公网地址>/vnc.html?autoconnect=1`，VNC 密码：`123456`。
4. 进入桌面后即可看到微信开发者工具，首次需扫码登录。

> 开发环境镜像的构建、更新、版本管理均在 wechat-dev-tools-cnb 项目中维护。
