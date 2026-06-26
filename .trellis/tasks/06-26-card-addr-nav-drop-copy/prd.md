# 卡片交互重构：地址行导航+砍复制

## 背景

复用之前对"复制地址"功能的评审结论：复制地址是冗余功能——
- "去店里"被导航按钮完全覆盖且更优（复制→切地图App→粘贴 vs 一键 openLocation）
- "分享"被小程序原生分享覆盖
- 唯一可能的用途（去点评搜店）现在还复制错了字段（复制的是 address 不是 name）

底部"导航"独立按钮存在感过重（导航是跳出小程序的重决策动作，不该常驻卡片底部）。

本次重构将"导航"从底部按钮迁移到地址行，语义更自然（点地址→去这里），同时砍掉冗余的复制地址。

## 范围

### 保留不动
- **🎫 领券按钮**：首页卡命中 shopEntry 时显示，逻辑、样式、事件全部不变。
  - 原因：🎫 是 `06-17-cps-affiliate-integration` 的商业入口，砍掉会与之冲突；本任务不触碰商业入口。

### 改动

1. **新增地址行**（`card-meta` 后）：`📍 {地址} ›`，点击触发 `onNavigate`（openLocation）
   - 地址为空时不显示该行
   - 地址过长用 ellipsis 截断
2. **砍掉复制地址**：
   - 盲盒卡：删 `onCopyAddr` 绑定 + `onMysteryCopyAddr` 方法
   - 首页卡：删 `onCopyAddr` 绑定 + `onCopyAddr` 方法
3. **砍掉底部"导航"独立按钮**（迁移到地址行）
4. **card-actions 容器处理**：
   - 盲盒卡：整个 `card-actions` 删除（没有🎫）
   - 首页卡：`card-actions` 仅在 `card.shopEntry` 为 true 时渲染，且只含🎫按钮；无 shopEntry 时不渲染整个 actions

## 涉及文件

| 文件 | 改动 |
|---|---|
| `components/restaurant-card/index.wxml` | 新增地址行；card-actions 按 variant+shopEntry 条件渲染 |
| `components/restaurant-card/index.js` | 删 onCopyAddr 方法 |
| `components/restaurant-card/index.wxss` | 新增 .card-loc 样式（地址行+箭头+点击反馈） |
| `pages/mystery/mystery.wxml` | 删 bind:copyaddr |
| `pages/mystery/mystery.js` | 删 onMysteryCopyAddr 方法 |
| `pages/index/index.wxml` | 删 bind:copyaddr |
| `pages/index/index.js` | 删 onCopyAddr 方法 |
| `app.wxss` | 评估 .action-btn 系列是否可清理（🎫 仍用，谨慎） |

## 验收标准

- [ ] 卡片显示地址行 `📍 {地址} ›`，地址为空时不显示
- [ ] 点地址行触发 openLocation 导航（与原导航按钮行为一致）
- [ ] 复制地址功能完全移除（无按钮、无方法、无绑定）
- [ ] 底部不再有独立的"导航"按钮
- [ ] 盲盒卡：底部无任何操作区（干净）
- [ ] 首页卡：命中 shopEntry 时底部显示🎫按钮；未命中时底部无操作区
- [ ] 🎫 领券功能不受影响（点击仍触发 onCoupon/onOpenCommercial）
- [ ] 无残留死代码（onCopyAddr / bind:copyaddr / card.address 引用保留——地址行要用）

## Notes

- 🎫 保留是硬约束，不能为了卡片简洁而牺牲商业入口。
- 全局 `.action-btn` 样式（app.wxss）被🎫复用，不能删；仅清理确认无引用的 `.card-actions` 相关样式需谨慎。
- 地址行复用现有 `card.address` 数据（首页 buildCardView 和盲盒 cardView 都已暴露 address）。
