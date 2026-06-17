# 执行计划：美团饿了么京东CPS分销接入

> 配套 `prd.md` / `design.md`。MVP 只交付「可填配置 + 可分发跳转」框架，真实推广位由用户后续填入。

## 实施顺序（按依赖）

### 1. 配置层：升级 `config/commercial.js`
- [ ] 改为 `{ platforms: [...], entries: [...] }` 结构
- [ ] platforms：美团（enabled:true，appId/path 占位 TODO）、饿了么（同）、京东（enabled:false，TODO）
- [ ] entries：保留为空数组 + 注释示例（兼容旧 `{ match, url }`）
- [ ] 顶部注释说明 type 语义与平台级 vs per-shop

### 2. 工具层：新增 `utils/commercialHelper.js`
- [ ] `getPlatformButtons()`：过滤 `enabled && appId && path`
- [ ] `lookupShopEntry(name)`：关键词匹配 entries
- [ ] `openEntry(entry)`：按 type 分发（miniprogram / webview→copy / copy）
- [ ] miniprogram 配置缺失 → toast「推广链接未配置」
- [ ] `wx.navigateToMiniProgram` fail → toast「跳转失败，请重试」+ console.warn
- [ ] `module.exports = { getPlatformButtons, lookupShopEntry, openEntry }`

### 3. 接入 index.js
- [ ] `require('../../utils/commercialHelper.js')`
- [ ] 移除/替换本地 `lookupCommercial`，改用 `lookupShopEntry`
- [ ] `data` 增加 `platformButtons: []`
- [ ] `onLoad`：`this.setData({ platformButtons: getPlatformButtons() })`
- [ ] `buildCardView`：`shopEntry: lookupShopEntry(poi.name)`（替换原 `commercialUrl`）
- [ ] `onOpenCommercial(e)`：取 `card.shopEntry` → `openEntry(shopEntry)`
- [ ] 新增 `onOpenPlatform(e)`：按 `data-key` 找 platform → `openEntry`

### 4. UI：index.wxml + index.wxss
- [ ] 卡片 `🎫`：`wx:if="{{item.shopEntry}}"`（替换 `commercialUrl`）
- [ ] 新增 `.coupon-bar`：`cardsView.length>0 && platformButtons.length>0` 时显示，`wx:for` platformButtons，`data-key` + `bindtap="onOpenPlatform"`
- [ ] wxss 新增 `.coupon-bar / .coupon-bar-title / .coupon-btns / .coupon-btn`，主题色 `#FF6B35`

## 验证（手动，本项目无自动化测试）

微信开发者工具中：
- [ ] **零回归**：未填真实 appId/path 时，coupon-bar 不显示、`🎫` 不显示，首页与改动前完全一致
- [ ] **平台跳转**：临时填入一个测试 appId+path（如饿了么官方小程序），点「饿了么红包」成功调起 `navigateToMiniProgram`
- [ ] **配置缺失降级**：platform enabled 但 appId 为空时，`getPlatformButtons` 过滤掉，按钮不出现
- [ ] **miniprogram 缺 path**：手动构造 entry 调 `openEntry` → toast「推广链接未配置」
- [ ] **per-shop 兼容**：`entries` 加一条 `{ match:'测试', url:'https://x' }`，对应商家卡片显示 `🎫`，点击复制成功
- [ ] **webview 类型**：构造 `{type:'webview',url}`，点击复制 + console 打 TODO
- [ ] **navigateToMiniProgram fail**：填一个不存在的 appId，点击 → toast「跳转失败，请重试」
- [ ] **不破坏现有**：导航 / 复制地址 / 换一批 / 场景切换 / AI推荐 全部正常

## 风险点 / 回滚

- **风险文件**：`config/commercial.js`、`pages/index/index.js`、`pages/index/index.wxml`、`pages/index/index.wxss`，新增 `utils/commercialHelper.js`
- **关键回归点**：`buildCardView` 字段改名（`commercialUrl` → `shopEntry`）必须 wxml 同步，否则按钮逻辑错乱
- **回滚**：`git checkout` 上述 4 文件 + 删除 `commercialHelper.js`；旧结构兼容，即使保留新空配置也不影响现状
- **最坏情况**：用户未填配置 → 无商业化 UI = 回到改动前状态

## 交付后用户需做（非代码）

- [ ] 到美团联盟 `union.meituan.com` 注册，拿美团外卖小程序 appId + 带 SID 的红包页 path
- [ ] 到淘宝联盟/阿里妈妈 `pub.alimama.com` 注册，拿饿了么小程序 appId + 带 inviterid 的 path
- [ ] 京东外卖待联盟 CPS 渠道开放后补配置、`enabled:true`
- [ ] 填入 `config/commercial.js` 对应 platform 的 `appId`/`path`
- [ ] （可选）配置业务域名 + 建 `pages/webview/index` 启用 webview 类型

## task.py start 前检查

- [ ] prd.md / design.md / implement.md 齐全且用户已 review
- [ ] 设计无遗留 open question
- [ ] 确认 MVP 不新增 page、不改 app.json、不动云函数
