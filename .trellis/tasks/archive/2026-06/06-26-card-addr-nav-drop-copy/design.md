# 卡片交互重构 - 技术设计

> 配套 `prd.md`。聚焦三个关键点：card-actions 条件渲染、地址行交互、全局样式清理边界。

## 1. 现状结构

restaurant-card/index.wxml 当前结构：
```
.card
├── .card-header     [name] [type]
├── .card-meta       [📍距离] [⭐评分] [💰人均]
├── .card-reason     [推荐理由]（条件）
└── .card-actions    [导航 primary] [复制地址] [🎫 ghost(仅首页+shopEntry)]
```

restaurant-card/index.js 方法：
- `onNavigate()` → triggerEvent('navigate', { location })
- `onCopyAddr()` → triggerEvent('copyaddr', { address })  ← 要删
- `onCoupon()` → triggerEvent('coupon', { poi_id, name })

## 2. 核心设计

### 决策 A：card-actions 条件渲染（首页卡保留🎫）

**盲盒卡（variant=mystery）：**
- 整个 `.card-actions` 删除（没有🎫，导航已迁走，复制已砍）

**首页卡（variant=index）：**
- `.card-actions` 用 `wx:if="{{card.shopEntry}}"` 包裹
  - shopEntry=true：渲染，只含🎫按钮
  - shopEntry=false：不渲染（卡片底部干净）

```xml
<view class="card-actions" wx:if="{{variant === 'index' && card.shopEntry}}">
  <view class="action-btn ghost" bindtap="onCoupon">🎫</view>
</view>
```

**理由：** 🎫 是商业入口，命中 shopEntry 的店才显示；其他店卡片底部应干净。用 wx:if 而非 CSS 隐藏，避免空容器占位。

### 决策 B：地址行作为导航入口

位置：`.card-meta` 与 `.card-reason` 之间。

```xml
<view class="card-loc" wx:if="{{card.address}}" bindtap="onNavigate">
  <text class="loc-text">📍 {{card.address}}</text>
  <text class="loc-arrow">›</text>
</view>
```

**交互：**
- 点击整行触发 `onNavigate`（复用现有方法，triggerEvent navigate → 页面 openLocation）
- 地址用 `text-overflow: ellipsis` 单行截断
- `›` 箭头暗示可点
- `:active` 加按压反馈（透明度/缩放）

**样式（新增 .card-loc）：**
```css
.card-loc {
  display: flex;
  align-items: center;
  margin-bottom: 18rpx;  /* 与 card-meta 一致间距 */
  padding: 10rpx 14rpx;
  background: #FFF8F3;   /* 与 card-reason 同色系，暗示"可交互区块" */
  border-radius: 10rpx;
}
.card-loc:active {
  opacity: 0.7;
}
.loc-text {
  flex: 1;
  min-width: 0;
  font-size: 24rpx;
  color: #8A7968;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.loc-arrow {
  flex-shrink: 0;
  font-size: 28rpx;
  color: #FF6B35;
  margin-left: 8rpx;
}
```

**放在 restaurant-card/index.wxss 还是 app.wxss？**
放 `restaurant-card/index.wxss`（组件专属，不污染全局）。组件 options.addGlobalClass=true，组件 wxss 里写新类即可生效。

### 决策 C：全局样式清理边界（谨慎）

app.wxss 的 `.card-actions / .action-btn / .action-btn.primary / .action-btn.ghost`：
- `.action-btn.ghost` 仍被🎫使用 → **保留**
- `.action-btn`（基础类）被🎫使用（ghost 继承）→ **保留**
- `.action-btn.primary`（导航按钮用）→ 导航按钮删了，**无引用了，可清理**
- `.card-actions`（flex 容器）→ 首页卡仍用（容纳🎫）→ **保留**

**结论：仅清理 `.action-btn.primary`。** 其余保留（避免误伤🎫）。

但 `.action-btn.primary` 删除前必须全局 grep 确认无其他引用（Pre-Modification Rule）。

## 3. 数据流（无变化）

- 地址行用 `card.address`（首页 buildCardView / 盲盒 cardView 都已暴露）
- 导航事件流不变：地址行 `bindtap=onNavigate` → `triggerEvent('navigate', {location})` → 页面 `onOpenNav/onMysteryNav` → `wx.openLocation`
- 🎫 事件流不变：`bindtap=onCoupon` → `triggerEvent('coupon')` → 页面 `onOpenCommercial`

## 4. 边界

| 场景 | 处理 |
|---|---|
| card.address 为空 | 地址行不渲染（`wx:if`） |
| 盲盒卡无地址数据 | 同上，不渲染地址行，卡片仍可用（导航按钮已删，但盲盒场景导航本就次要） |
| 首页卡无 shopEntry | card-actions 不渲染，卡片底部干净 |
| 地址超长 | ellipsis 单行截断 |

## 5. 兼容性

- 不改 locationHelper / scoring / poiFilter / scenes 等工具
- 不改 buildCardView / cardView 数据结构（address/location/shopEntry 都已存在）
- 🎫 商业入口完全不受影响
- 盲盒页和首页页面的 navigate/coupon 事件处理方法保留（地址行复用 navigate）

## 6. 不做的事

- ❌ 不动🎫领券逻辑（硬约束）
- ❌ 不做"复制店名"兜底（去点评搜店）——之前讨论过，属可选增强，本次不做
- ❌ 不改卡片整体布局（header/meta/reason 顺序不变）
