# 初始化微信小程序开发模板

## Goal

为 WhatToEat-AI 初始化一个原生微信小程序开发模板，使项目可以直接导入微信开发者工具并开始开发“今天吃什么”类产品体验。

## Requirements

* 使用微信原生小程序结构，不引入额外构建链或 npm 依赖。
* 提供可导入微信开发者工具的项目配置。
* 提供全局入口文件、全局样式、首页、日志页和基础工具函数。
* 首页围绕 WhatToEat-AI 的核心场景，提供餐食推荐起始界面和本地随机推荐交互。
* 不移动或修改 `参考图片/`、`.trellis/`、`.codex/`、`.agents/` 目录内容。

## Acceptance Criteria

* [ ] 项目根目录包含 `project.config.json`、`app.js`、`app.json`、`app.wxss` 和 `sitemap.json`。
* [ ] `pages/index/` 和 `pages/logs/` 均包含 `.js`、`.json`、`.wxml`、`.wxss` 页面文件。
* [ ] `utils/util.js` 提供页面可复用的格式化和随机选择工具。
* [ ] `app.json`、页面 JSON 和项目 JSON 能被 JSON 解析。
* [ ] 模板可以作为微信开发者工具中的小程序项目导入。

## Definition of Done

* 小程序模板文件已写入项目根目录。
* 基础结构和 JSON 文件已检查。
* 交付说明包含导入方式和主要文件清单。

## Technical Approach

采用微信原生小程序 JavaScript 模板：

* 根目录保存小程序配置和应用入口。
* `pages/index/` 实现首页推荐交互。
* `pages/logs/` 展示本地访问日志，便于验证导航和本地存储。
* `utils/` 放置通用函数，避免页面内重复逻辑。

## Decision (ADR-lite)

**Context**: 当前项目没有已有小程序源码，也没有前端框架配置。用户要求初始化微信小程序开发模板。

**Decision**: 使用微信原生小程序模板，而不是 Taro、uni-app 或自定义构建链。

**Consequences**: 起步成本低，可直接导入微信开发者工具；后续如果需要跨端或 TypeScript 工程化，可以在此基础上迁移或增量引入。

## Out of Scope

* 接入真实 AI 接口或后端服务。
* 配置云开发环境。
* 引入第三方 UI 库、状态管理库或跨端框架。
* 提交 git commit，因为当前目录不是 git 仓库。

## Technical Notes

* Repo inspection on 2026-06-06: root contained Trellis/Codex support files, `AGENTS.md`, and `参考图片/`; no mini program source existed.
* Relevant Trellis frontend spec files are present but still placeholders, so standard WeChat Mini Program conventions are used.
