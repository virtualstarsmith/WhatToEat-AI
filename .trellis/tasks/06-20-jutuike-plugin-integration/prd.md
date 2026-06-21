# 聚推客外卖插件接入（嵌入式 plugin）

> 父任务：`06-17-cps-affiliate-integration`（CPS 分销框架）
> 本任务为父任务的延伸落地：把框架的占位配置替换为真实可跳转的聚推客插件入口。

## Goal

将父任务搭建的 CPS 框架（`config/commercial.js` + `utils/commercialHelper.js`）从「全占位、不可跳」升级为「真实可跳转、可归因」的聚推客外卖红包入口。用户在首页推荐卡片区域点击「美团红包」「饿了么红包」时，通过聚推客「外卖美食团购」**微信小程序插件**（provider `wx5c787b48e6a02a51`）嵌入式打开对应平台外卖页，携带开发者的 `pub_id` 完成归因返佣。

选型依据（父任务 `research.md` 已记录）：美团个人 CPS API 已关闭、饿了么/京东需联盟资质门槛，**个人起步走聚推客聚合平台拿小程序路径是最现实的路径**，且聚推客提供官方授权的微信小程序插件，体验优于小程序跳小程序。

## Confirmed Design Decisions

1. **只接聚推客这一家**（用户确认）。移除父任务中 meituan/eleme/jd 三条「直连官方小程序」占位，收敛为聚推客插件入口。git 可追溯，后续若拿直连 SID 可恢复。
2. **嵌入式 `plugin://` 接入**（用户确认），而非「小程序跳小程序」。需在 `app.json` 首次声明 `plugins`。
3. **首页放两个入口按钮**：美团外卖 + 饿了么外卖（用户确认「美团+饿了么外卖」），均走聚推客插件 `shop` 页，分别带 `type=meituan` / `type=ele`。

## ⚠️ 破例说明（首次修改 app.json）

父任务 `implement.md` 约定「MVP 不改 app.json / 不动云函数 / 不新增 page」。本任务**破例新增 `app.json` 的 `plugins` 字段**，理由：
- 嵌入式插件（`plugin://`）是聚推客的官方推荐接入方式，体验优于跳出当前小程序；
- 仅新增一个 `plugins` 声明，不涉及分包、不动 `pages`、不动云函数，风险可控；
- 父任务的 web-view / 复制兜底链路不受影响，`openEntry` 新增 `plugin` 分支保持向后兼容。

未新增 page、未动云函数，仍守住父任务其余边界。

## Requirements

**app.json（首次声明插件）：**
- 新增 `plugins.meishi`：`{ version, provider: "wx5c787b48e6a02a51" }`
- 别名 `meishi` 必须与 `plugin://meishi/...` 前缀一致

**config/commercial.js（platforms 收敛）：**
- 移除 meituan/eleme/jd 三条直连占位
- 新增两条聚推客入口，字段：`{ key, label, type:'plugin', pluginProvider:'meishi', pluginPath, pubId, enabled }`
  - 美团：`pluginPath: 'shop?type=meituan&sid=plugin'`
  - 饿了么：`pluginPath: 'shop?type=ele&sid=plugin'`
- `pubId` 填聚推客联盟后台的真实推广位 ID（归因/返佣来源）
- 顶部注释更新：新增 `'plugin'` 类型说明 + 聚推客插件 shop 页 `type`+`sid` 必传约定

**utils/commercialHelper.js（扩展分发）：**
- `getPlatformButtons()` 过滤按 type 区分：`plugin` 类型用 `pluginProvider && pluginPath` 判定可跳
- `openEntry()` 新增 `plugin` 分支：拼 `plugin://<provider>/<path>`，`pluginPath` 含 `?` 时用 `&` 追加 `pub_id`，否则用 `?`，走 `wx.navigateTo`，fail 时 toast 降级
- 已有 miniprogram/webview/copy 分支保持不变

**pages/index：** 无需改动（只调 `openEntry`，框架解耦，自动复用）

## Acceptance Criteria

### 结构与配置
- [x] `app.json` 新增 `plugins.meishi`（provider `wx5c787b48e6a02a51`）
- [x] `commercial.js` 只保留聚推客两条入口（美团+饿了么），三处直连占位移除
- [x] `pluginPath` 含 `type`+`sid=plugin`（官方文档要求，否则页面加载异常）

### 分发逻辑
- [x] `openEntry` 新增 `plugin` 分支，URL 拼接正确（带 query 时用 `&`）
- [x] `getPlatformButtons` 对 plugin 类型用 `pluginProvider && pluginPath` 过滤
- [x] 缺配置 / 跳转失败有 toast 降级，不崩溃
- [x] 已有 miniprogram/webview/copy 分支向后兼容未破坏

### 验证（代码侧，已完成）
- [x] `node --check` 三个 JS 文件语法正确
- [x] `app.json` 合法 JSON
- [x] 模拟 URL 拼接输出与官方文档示例一致：
  - `plugin://meishi/shop?type=meituan&sid=plugin&pub_id=469210`
  - `plugin://meishi/shop?type=ele&sid=plugin&pub_id=469210`

### 真机验证（代码无法替代，交付后用户做）
- [ ] 微信后台添加插件「外卖美食团购」(wx5c787b48e6a02a51) 并审核通过
- [ ] app.json `version` 与后台插件详情页一致（当前 `1.2.5`，以后台为准）
- [ ] 首页出现「🎁 领红包下单更省」+「美团红包」「饿了么红包」两个按钮
- [ ] 点击分别跳转美团/饿了么外卖插件页，页面加载正常
- [ ] 聚推客后台订单页确认 `pub_id` 透传成功（真实下单归因验证）

## Out of Scope

- 电商（dianshang）、京东精选（jingdong）、美团券包（coupon）、美团团购（home）、打车出行、酒店住宿等其他聚推客插件入口（本任务只做外卖双入口，需要时按同构方式新增 platform 条目即可）
- CPS 订单回执 / 佣金对账（父任务已列为二期）
- mystery（盲盒）页接入红包 bar（父任务 follow-up，低成本复用 helper）
- 真实下单返佣验证（依赖用户在聚推客后台操作）

## Notes

- 代码改动已完成并通过语法/逻辑校验（见 Acceptance Criteria 验证项）。
- 关键纠错：插件别名是 `meishi`（非最初推测的 `jutuike-food`），pluginPath 是 `shop?type=xxx&sid=plugin`（非 `pages/index/index`），均以聚推客官方接入文档为准。
- `sid=plugin` 是固定值（表示"来自插件渠道"），不是推广位；归因靠 `pub_id`。
- 轻量任务，PRD-only。真实 pub_id / 插件版本号 / 插件入口路径需用户对照后台与文档核对，代码留 TODO 注释处已标注。
