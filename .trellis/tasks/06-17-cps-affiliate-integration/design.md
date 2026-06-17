# 技术设计：美团饿了么京东CPS分销接入

> 配套 `prd.md`。MVP 目标：把「复制链接」占位升级为「平台级入口 + 按 type 分发跳转」的可归因框架。真实推广位由用户后续填入。

## 1. 架构与边界

```
config/commercial.js          配置（平台级 platforms + per-shop entries），占位 + TODO
        │
        ▼
utils/commercialHelper.js     【新增】集中读取配置 + dispatch 跳转（复用于 index/mystery）
   ├─ getPlatformButtons()    过滤出 enabled 且 appId+path 齐全的平台
   ├─ lookupShopEntry(name)   per-shop 关键词匹配（兼容旧 entries）
   └─ openEntry(entry)        按 type 分发：miniprogram / webview / copy
        │
        ▼
pages/index/index.js          引入 helper；卡片视图挂 shopEntry；页面 data 挂 platformButtons
pages/index/index.wxml        新增「外卖红包」bar；卡片 🎫 按钮复用 dispatch
pages/index/index.wxss        coupon-bar 样式
```

**边界：**
- 配置纯静态，集中在一处，不引入云函数 / 网络。
- 跳转逻辑下沉到 `utils/commercialHelper.js`，避免在 page 里散落 `wx.navigateToMiniProgram`，便于 mystery 页后续复用。
- 本任务只动 index 页；mystery 页接入列为 follow-up（复用同一 helper，成本极低）。

## 2. 数据契约

### 2.1 `config/commercial.js`（升级后）

```js
// 商业化（CPS 分销）配置
// 两类入口：
//   platforms —— 平台级「领红包」入口（主返佣来源），每家平台一条
//   entries   —— 按商家名关键词匹配的专属入口（兼容兜底，默认空）
// type 决定点击行为：
//   'miniprogram'  wx.navigateToMiniProgram(appId, path)   ← 推荐主路径
//   'webview'      MVP 回退复制（业务域名未配）；后续跳 pages/webview/index
//   'copy'/缺省    复制 url
module.exports = {
  platforms: [
    {
      key: 'meituan',
      label: '美团红包',
      type: 'miniprogram',
      appId: '',        // TODO: 美团外卖官方小程序 appId（美团联盟后台获取）
      path: '',         // TODO: 带 SID 的红包页路径，如 pages/xxx?sid=你的SID
      enabled: true
    },
    {
      key: 'eleme',
      label: '饿了么红包',
      type: 'miniprogram',
      appId: '',        // TODO: 饿了么官方小程序 appId（淘宝联盟/阿里妈妈获取）
      path: '',         // TODO: pages/xxx?inviterid=你的inviterid&activityId=20150318020002192
      enabled: true
    },
    {
      key: 'jd',
      label: '京东外卖',
      type: 'miniprogram',
      appId: '',        // TODO: 京东/京东外卖小程序 appId（京东联盟，CPS 渠道待开放）
      path: '',
      enabled: false    // 京东外卖 CPS 尚不成熟，默认关闭
    }
  ],
  entries: [
    // 兼容旧结构：{ match: '麦当劳', type: 'miniprogram', appId, path }
    // 或无 type：{ match: '蜜雪冰城', url: 'https://...' } → 默认 copy
  ]
};
```

**字段约定：**
- `type` 缺省 = `copy`（向后兼容旧 `{ match, url }`）。
- platform 启用条件：`enabled !== false && appId && path`（两者都填才算「可跳」）。
- `path` 必须内含推广位参数（`sid`/`inviterid`），这是归因/返佣的来源；TODO 注释明确。

### 2.2 卡片视图新增字段

`buildCardView(rec)` 在现有 `commercialUrl` 基础上补 `hasShopEntry`（布尔），wxml 据此决定 `🎫` 显隐。保留 `commercialUrl` 名字以减少 wxml 改动，但语义改为「有 per-shop 命中」。

> 更清晰的做法：`buildCardView` 返回 `shopEntry`（整个对象或 null），wxml 用 `wx:if="{{item.shopEntry}}"`。本设计采用此方案，并把 `commercialUrl` 字段移除/替换为 `shopEntry`，同步改 wxml:82。

### 2.3 页面 data 新增

- `platformButtons`：`getPlatformButtons()` 结果，onLoad 时计算一次。

## 3. 数据流

### 平台级（主路径）
```
index onLoad → commercialHelper.getPlatformButtons() → setData({platformButtons})
用户点「美团红包」→ onOpenPlatform(e) → openEntry(platform) → wx.navigateToMiniProgram(appId, path)
```

### per-shop（兼容兜底）
```
buildCardView(poi) → lookupShopEntry(poi.name) → card.shopEntry
用户点卡片 🎫 → onOpenCommercial(e) → openEntry(card.shopEntry) → 按 type 分发
```

## 4. `utils/commercialHelper.js` 关键实现

```js
const commercial = require('../config/commercial.js');

// 启用且配置齐全的平台
function getPlatformButtons() {
  const list = (commercial && commercial.platforms) || [];
  return list.filter(p => p && p.enabled !== false && p.appId && p.path);
}

// per-shop 关键词匹配（兼容旧 entries）
function lookupShopEntry(name) {
  if (!name) return null;
  const entries = (commercial && commercial.entries) || [];
  return entries.find(e => e && e.match && name.indexOf(e.match) >= 0) || null;
}

// 按 type 分发跳转
function openEntry(entry) {
  if (!entry) return;
  const type = entry.type || 'copy';
  if (type === 'miniprogram') {
    if (!entry.appId || !entry.path) {
      wx.showToast({ title: '推广链接未配置', icon: 'none' });
      return;
    }
    wx.navigateToMiniProgram({
      appId: entry.appId,
      path: entry.path,
      envVersion: entry.envVersion || 'release',
      fail(err) {
        wx.showToast({ title: '跳转失败，请重试', icon: 'none' });
        console.warn('[commercial] navigateToMiniProgram fail', err);
      }
    });
    return;
  }
  // copy 与 webview（MVP 回退）都走复制
  if (entry.url) {
    wx.setClipboardData({
      data: entry.url,
      success: () => wx.showToast({
        title: type === 'webview' ? '链接已复制（H5待配置）' : '优惠链接已复制',
        icon: 'success', duration: 1500
      })
    });
    if (type === 'webview') {
      console.warn('[commercial] webview 类型待接入：需配置业务域名 + pages/webview/index', entry.url);
    }
  }
}

module.exports = { getPlatformButtons, lookupShopEntry, openEntry };
```

## 5. index.js / wxml 改动点

**index.js：**
- 顶部 `require('../../utils/commercialHelper.js')`，移除/精简 `lookupCommercial`（改用 helper）。
- `data` 增加 `platformButtons: []`；`onLoad` 中 `this.setData({ platformButtons: getPlatformButtons() })`。
- `buildCardView`：`shopEntry: lookupShopEntry(poi.name)`（替换原 `commercialUrl`）。
- `onOpenCommercial(e)`：取 `card.shopEntry` → `openEntry(shopEntry)`。
- 新增 `onOpenPlatform(e)`：取 `data-key` 对应 platform → `openEntry(platform)`。

**index.wxml：**
- 卡片 `🎫`：`wx:if="{{item.shopEntry}}"`，`data-idx`，`bindtap="onOpenCommercial"`。
- 新增 coupon-bar（置于 `.cards` 之前，`cardsView.length>0 && platformButtons.length>0` 时显示）：
```xml
<view class="coupon-bar" wx:if="{{cardsView.length > 0 && platformButtons.length > 0}}">
  <text class="coupon-bar-title">🎁 领红包下单更省</text>
  <view class="coupon-btns">
    <view wx:for="{{platformButtons}}" wx:key="key"
          class="coupon-btn" data-key="{{item.key}}" bindtap="onOpenPlatform">
      {{item.label}}
    </view>
  </view>
</view>
```

**index.wxss：** 新增 `.coupon-bar / .coupon-bar-title / .coupon-btns / .coupon-btn`，沿用主题色（`#FF6B35`）。

## 6. 兼容性

- 旧 `{ match, url }` 无 `type` → `openEntry` 走 copy 分支，行为与现状一致。
- `entries` 默认空 → 卡片 `🎫` 不显示，无视觉变化。
- `platforms` 全占位（appId/path 空）→ `getPlatformButtons()` 返回空 → coupon-bar 不显示。**即：用户未填真实配置前，UI 与现状完全一致，零回归风险。**
- 不改动 `app.json`（不新增 page）、不改动云函数、不改动 mystery 页。

## 7. 重要权衡

| 决策 | 选择 | 理由 |
|---|---|---|
| 平台级 vs per-shop | 平台级为主 | 外卖商家几乎无专属 CPS 链接；红包推广才是真实返佣模型 |
| 主跳转方式 | navigateToMiniProgram | 外卖用户在微信内，跳官方小程序归因最稳 |
| web-view | MVP 回退复制 | 用户暂无备案域名，避免交付无法运行的页面 |
| 京东 | enabled:false 占位 | 外卖 CPS 渠道待成熟，留位不阻塞 |
| 配置缺失时 | toast 提示而非崩溃 | 占位阶段用户会点，需友好降级 |

## 8. 合规 / 运营注意

- 小程序类目需为「餐饮 / 生活服务」；文案避免「返利/刷单」等词，用「领红包/优惠」。
- 推广位标识（sid/inviterid）必须由用户在联盟后台实名注册获得；占位值不可上线（无归因 = 无佣金）。
- `wx.navigateToMiniProgram` 需用户手势触发（本设计均为按钮 tap，满足）。

## 9. 回滚

- 改动集中在 4 文件（`commercial.js` / 新增 `commercialHelper.js` / `index.js` / `index.wxml` + `.wxss`）。
- 回滚：`git checkout` 上述文件 + 删除 `commercialHelper.js`；因旧结构兼容，即便保留新 `commercial.js`（空 platforms/entries）也不影响现状。
- 最坏情况：用户未填配置 → 无任何商业化 UI 出现 = 回到当前状态。
