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
# WhatToEat-AI
