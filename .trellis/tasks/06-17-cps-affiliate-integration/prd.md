# 美团饿了么京东CPS分销接入

## Goal

在 WhatToEat-AI 微信小程序中接入美团、饿了么、京东外卖的个人 CPS 分销推广链接，使用户从推荐卡片下单时能携带开发者（推广者）的推广位标识，从而获得佣金返利。把当前「复制链接」的占位实现升级为真正可跳转、可归因的分销入口。

## Current Context

**Confirmed Facts（代码证据）：**
- 项目是微信小程序原生开发，餐饮推荐场景
- 已有商业化脚手架：`config/commercial.js`，结构 `entries: [{ match, url }]`，默认空数组
- `pages/index/index.js`：
  - `lookupCommercial(name)` 按关键词命中商家名，返回 `entry.url`
  - `buildCardView()` 把 `commercialUrl` 挂到卡片视图
  - `onOpenCommercial(e)` 当前实现为 `wx.setClipboardData`（复制到剪贴板）
- `pages/index/index.wxml:80-85`：卡片底部 `🎫` 按钮，`wx:if="{{item.commercialUrl}}"` 控制显隐
- 卡片底部现有按钮：`导航 / 复制地址 / 🎫`
- 数据源：`getPoi` 云函数返回的 POI 商家列表（高德），含 `name`

**Confirmed Facts（CPS 政策，详见 research.md）：**
- 美团：美团联盟 `union.meituan.com`，外卖佣金约 3%，短链有效期约 120 天；**个人 CPS API 接口已关闭**，只能走「小程序跳小程序 + 带 SID 的小程序路径」
- 饿了么：经阿里妈妈 / 淘宝联盟 `pub.alimama.com`，取带 `inviterid` 的饿了么小程序路径；常用活动 ID `20150318020002192`
- 京东外卖：京东联盟 `union.jd.com`，接口需流量资质门槛，个人起步建议走聚合平台（聚推客 `jutuike.com` / 折淘客 `zhetaoke.com`）
- 真实推广位 / 小程序路径必须由开发者本人到联盟后台注册获取，代码无法替代

## Confirmed Design Decisions

1. **入口形态：平台级入口为主 + per-shop 关键词兼容兜底**（用户确认"看你的推荐"）
   - 主返佣来源：每家平台一条「领红包」入口，跳官方小程序红包/落地页，携带 `sid`/`inviterid`
   - 保留 `entries` 按商家名匹配作为兼容（极少数品牌专属活动可用），默认空
2. **MVP 平台范围：美团 + 饿了么优先**，京东外卖留配置位 + `enabled:false` + TODO（CPS 渠道待联盟成熟）
3. **web-view：MVP 仅留代码入口，暂回退复制**（用户暂无备案域名）。`type:'webview'` 在 dispatch 中被识别，但 MVP 行为为复制 + console TODO；后续配业务域名再补 `pages/webview/index`
4. **跳转主路径：`wx.navigateToMiniProgram`**（外卖类目正解，归因最稳）

## Requirements

**配置结构：**
- `commercial.js` 升级为 `{ platforms: [...], entries: [...] }`
- 每条 platform：`{ key, label, type, appId, path, enabled? }`
- 旧 `{ match, url }`（无 type）向后兼容，默认按 `copy` 处理

**跳转分发：**
- 新增 `utils/commercialHelper.js`，集中 dispatch 逻辑（供 index 与后续 mystery 页复用）
- `openEntry(entry)` 按 `type` 分发：
  - `miniprogram` → `wx.navigateToMiniProgram(appId, path)`，缺失配置时 toast 提示
  - `webview` → MVP 回退复制 + TODO 日志
  - `copy` / 缺省 → `wx.setClipboardData`
- 平台级入口：`getPlatformButtons()` 返回 `enabled && appId && path` 齐全的平台
- per-shop：`lookupShopEntry(name)` 关键词匹配

**UI（index 页）：**
- 新增「外卖红包」bar，`cardsView.length > 0 && platformButtons.length > 0` 时展示，含各启用平台按钮
- 卡片 `🎫` 按钮保留（per-shop 命中时显示），点击走同一 dispatch

## Acceptance Criteria

### 结构与配置
- [ ] `commercial.js` 支持 `platforms`（平台级）+ `entries`（per-shop）两类
- [ ] 美团、饿了么各一条 platform 配置（appId/path 占位 + TODO 注释）；京东一条 `enabled:false`
- [ ] 旧 `{ match, url }` entry 无 `type` 时仍按复制工作（向后兼容）

### 跳转分发（utils/commercialHelper.js）
- [ ] `openEntry` 对 `miniprogram` 类型调用 `wx.navigateToMiniProgram`，传 `appId`+`path`
- [ ] `miniprogram` 配置缺失（appId/path 空）时 toast「推广链接未配置」，不报错
- [ ] `webview` 类型 MVP 回退复制，console 打 TODO
- [ ] `copy`/缺省 类型复制 url，toast「优惠链接已复制」
- [ ] `navigateToMiniProgram` 失败有 toast 提示

### UI（index）
- [ ] 推荐卡片存在且平台已配置时，显示「外卖红包」bar 与对应平台按钮
- [ ] 点击平台按钮跳转对应官方小程序（携带推广位）
- [ ] 卡片 `🎫` 按钮 per-shop 命中时显示，点击走 dispatch
- [ ] 不破坏现有 导航 / 复制地址 / 换一批 / 场景切换 逻辑

### 合规与交付说明
- [ ] 交付说明（design.md / 注释）提示：需小程序类目为餐饮/生活服务、文案避开返利导购红线
- [ ] 推广位标识正确拼接到 path（由用户填真实值），归因不丢

## Out of Scope

- CPS 订单回执 / 佣金对账（依赖联盟 API，二期）
- 京东联盟 API 实时取链（流量资质门槛，二期）
- 美团个人 CPS API 实时取链（官方已关闭）
- `pages/webview/index` 完整实现 + 业务域名备案（用户侧基础设施，本任务仅留入口与 TODO）
- 推广数据统计看板（二期）
- mystery（盲盒）页接入平台红包 bar（MVP 后低成本复用，列为 follow-up）

## Open Questions

（已全部解决，无遗留问题）

## Notes

- 详细调研见 `research.md`，技术设计见 `design.md`，执行清单见 `implement.md`。
- 真实推广位 / appId / path 需用户到联盟后台注册后填入 `commercial.js`，本任务交付「可填配置 + 可分发跳转」的代码框架。
- 复杂任务，规划通过后 `task.py start` 进入实现。
