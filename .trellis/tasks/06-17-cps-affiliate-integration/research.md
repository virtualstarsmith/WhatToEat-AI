# 外卖 CPS 分销接入调研（美团 / 饿了么 / 京东外卖）

> 本文档为「如何在 WhatToEat-AI 微信小程序中引入美团、饿了么、京东外卖的推广链接并转佣金」的完整调研结论。
> 调研日期：2026-06-17。政策与佣金以各联盟后台当时开放为准。

---

## 一、整体机制（赚的是谁的钱）

```
你的小程序 → 带着你的"推广位ID"跳到 美团/饿了么/京东小程序 → 用户下单 → 平台按订单返佣给你
```

**关键点**：不是放一个普通链接就能拿佣金。链接 / 路径里必须带上你在联盟后台申请到的**推广位标识**：
- 美团：`SID`
- 饿了么：`inviterid` / `activityId`
- 京东：`unionId` / `subUnionId`

普通官方链接没有你的标识 = 白推广。

---

## 二、三家的个人推广链接去哪申请

### 1. 美团（美团外卖 / 到店）
- **入口**：美团联盟 `union.meituan.com`（旧入口 `pub.meituan.com`）
- **佣金**：外卖类目约 **3%**，短链有效期约 **120 天**
- **流程**：注册 → 推广者备案 → "推广位管理"新增推广位 → 拿到 **SID** → 对活动点"立即推广" → 选推广位 → **获取链接**（可生成 H5链接 / 小程序路径 / 小程序码 / 二维码）
- ⚠️ **重要现实**：美团外卖的**个人 CPS API 接口已关闭**。现在能做的方式是「**小程序跳小程序**」——在联盟后台拿到带 SID 的「美团外卖小程序路径」，再用 `wx.navigateToMiniProgram` 跳。这也是项目 `commercial.js` 注释提到"MVP 阶段不对接 CPS"的原因。

### 2. 饿了么
- **入口**：通过 **阿里妈妈 / 淘宝联盟** `pub.alimama.com`（饿了么的 CPS 归阿里妈妈管）
- **流程**：淘宝账号登录 → 媒体备案 → 创建推广位（得到 `mm_xxx_xxx_xxx`）→ APPKEY 申请 → 联盟开放平台创建应用 → 拿 app key
- **取小程序路径**：打开「淘宝联盟」APP → 首页「吃喝玩乐」→「饿了么微信推广活动」→ 选活动 → 分享图片里的「微信小程序码」→ 扫码拿到带 `inviterid` 的小程序路径
- 饿了么常用活动 ID：`20150318020002192`（以联盟后台实际为准）
- 佣金约 **3%**

### 3. 京东 / 京东外卖
- **入口**：京东联盟 `union.jd.com`（含京粉 / CPS）
- **门槛**：注册简单，但**开放 API 接口需要流量资质**，个人 / 小程序初期往往不够格
- **京东外卖**是 2025 年新业务，CPS 渠道仍在完善，目前更多走「京享红包 / 京粉」通用链路，外卖专属活动以联盟后台当时开放的为准

### 🪜 捷径：聚合平台（推荐个人起步用）
分别对接三家很麻烦，可用**官方授权的聚合服务商**，一套 API 出三家链接 + 订单回执：
- **聚推客联盟** `jutuike.com`（淘 / 美 / 京多平台，支持小程序路径下发）
- **折淘客** `zhetaoke.com`（免费转链 + 订单接口）

> 起步建议：**美团 + 饿了么走聚推客 / 官方拿小程序路径，京东外卖看联盟后台是否开放**，避免一上来就死磕 API 资质。

---

## 三、微信小程序里怎么真正跳过去（技术落点）

当前 `onOpenCommercial` 是「复制链接」，转化最差。有三种升级方式，按推荐度排序：

### 方式 A：小程序跳小程序（强烈推荐，外卖类目正解）
外卖用户大多在微信里，直接跳官方小程序体验最好、归因最稳：

```js
wx.navigateToMiniProgram({
  appId: 'wx...',                          // 美团外卖 / 饿了么 官方小程序 appId
  path: 'pages/xxx?inviterid=你的推广位&activityId=20150318020002192',
  envVersion: 'release',
  success(res) { /* 归因成功 */ }
})
```
- `path` 里的 `inviterid` / `sid` 就是你的推广位 → 这就是佣金来源
- 不需要对方白名单（微信已开放），但目标小程序本身要允许被跳转（官方小程序都允许）

### 方式 B：web-view 内嵌 H5
```html
<web-view src="https://你的域名/promo.html?sid=xxx"></web-view>
```
- 需要在**小程序后台 → 开发管理 → 业务域名**配置，并把微信校验文件传到服务器根目录
- 域名必须 **HTTPS + ICP 备案 + 你自己主体**
- 适合「红包中转页」这类场景

### 方式 C：复制链接（当前实现）
- 门槛最低、转化最低，仅作为兜底

---

## 四、落到本项目：升级 `config/commercial.js`

当前结构只支持 `{ match, url }` 复制。要支持小程序跳转，建议扩成**带 type 分发**：

```js
// config/commercial.js —— 升级版
module.exports = {
  entries: [
    {
      match: '麦当劳',
      type: 'miniprogram',                 // 跳美团外卖小程序
      appId: 'wx...',                      // ← 联盟后台拿到的美团外卖小程序 appId
      path: 'pages/food/home?sid=你的SID'  // ← 含你的推广位
    },
    {
      match: '肯德基',
      type: 'miniprogram',                 // 跳饿了么小程序
      appId: 'wx...',
      path: 'pages/share/index?inviterid=你的inviterid&activityId=20150318020002192'
    },
    {
      match: '蜜雪冰城',
      type: 'webview',                     // 走你的 H5 中转页
      url: 'https://你的域名/promo?sid=xxx'
    }
  ]
};
```

点击处（`index.js` 现在的「复制 url」逻辑）改成按 `type` 分发：
- `miniprogram` → `wx.navigateToMiniProgram`
- `webview` → 跳一个本地 `pages/webview/index` 用 `<web-view>` 加载
- 兜底才复制

---

## 五、几个必须知道的坑（合规 & 审核）

1. **小程序类目**：要选「餐饮 / 生活服务」类。纯「返利导购」类目容易被审核拒，描述别写得像刷单返利。
2. **美团个人 CPS API 关闭**：只能走小程序路径 / 小程序码方式，不要执着于 API 实时取链。
3. **京东联盟接口要流量门槛**：个人起步直接走聚合平台（聚推客 / 折淘客）更现实。
4. **web-view 必须备案域名 + 校验文件**，没有服务器 / 备案就走方式 A。
5. **微信平台规则**：禁止诱导分享、禁止违规导流，推广文案别碰红线。

---

## 六、本项目现状（代码证据）

- `config/commercial.js`：`entries: [{ match, url }]`，默认空数组。
- `pages/index/index.js`：
  - `lookupCommercial(name)` → 关键词命中返回 `entry.url`
  - `buildCardView()` 把 `commercialUrl` 挂到卡片视图
  - `onOpenCommercial(e)` → `wx.setClipboardData`（复制）
- `pages/index/index.wxml:82`：`wx:if="{{item.commercialUrl}}"` 控制按钮显隐
- 脚手架已就绪，**缺**：
  1. 真实推广位 / 小程序路径（需用户到联盟后台注册，代码无法替用户完成）
  2. `onOpenCommercial` 从「复制」升级为「按 type 分发跳转」的代码

---

## Sources

- 美团联盟推广操作手册（官方 PDF）
- learnku.com/articles/57923 — 自己对接美团 / 饿了么 / 京东 CPS 的过程
- zhuanlan.zhihu.com/p/372532514 — CPS 美团取链 & 饿了么获取小程序路径
- github.com/Tech-Chao/waimai_red_envelope — 外卖红包 CPS 小程序
- jutuike.com — 聚推客联盟（聚合 CPS 服务商）
- union.jd.com — 京东联盟
- union.meituan.com — 美团联盟
- pub.alimama.com — 阿里妈妈 / 淘宝联盟（饿了么 CPS 入口）
