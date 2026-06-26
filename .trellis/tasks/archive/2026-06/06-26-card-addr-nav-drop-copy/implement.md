# 卡片交互重构 - 执行计划

> 配套 `design.md`。

## 执行清单

### Step 1: restaurant-card 组件改造（核心）

**index.wxml：**
- card-meta 后、card-reason 前插入地址行（`wx:if="{{card.address}}"` + `bindtap="onNavigate"`）
- card-actions 改条件渲染：`wx:if="{{variant === 'index' && card.shopEntry}}"`，内部只留🎫

**index.js：**
- 删除 `onCopyAddr` 方法

**index.wxss：**
- 新增 `.card-loc / .loc-text / .loc-arrow` 样式（见 design §2.B）

**验证：** 组件结构正确，🎫 在 shopEntry 时显示。

---

### Step 2: 盲盒页清理（mystery）

**mystery.wxml：** 删 `bind:copyaddr="onMysteryCopyAddr"`
**mystery.js：** 删 `onMysteryCopyAddr` 方法

**验证：** 盲盒卡底部无操作区，地址行可点导航。

---

### Step 3: 首页清理（index）

**index.wxml：** 删 `bind:copyaddr="onCopyAddr"`
**index.js：** 删 `onCopyAddr` 方法

**验证：** 首页卡命中 shopEntry 显示🎫，未命中底部干净；地址行可点导航。

---

### Step 4: 全局样式清理（谨慎）

- grep 确认 `.action-btn.primary` 无其他引用（除已删的导航按钮）
- 删除 `.action-btn.primary`（app.wxss）
- 保留 `.card-actions / .action-btn / .action-btn.ghost`（🎫仍用）

**验证：** 🎫 样式正常，无样式丢失。

---

### Step 5: 残留检查

- grep `copyaddr` / `onCopyAddr` / `onMysteryCopyAddr` 确认无残留
- grep `action-btn primary` / `onNavigate` 绑定确认导航迁移完整

---

## 回滚点

- Step 1 组件改动可整体 revert（组件是自包含单元）
- Step 2-3 页面清理独立，可单独 revert
- Step 4 全局样式删除前已 grep 验证，风险低

## 完成标准

- [ ] 地址行显示，点击触发导航
- [ ] 地址为空时不显示地址行
- [ ] 复制地址完全移除（按钮+方法+绑定）
- [ ] 底部无独立导航按钮
- [ ] 盲盒卡底部干净
- [ ] 首页卡 shopEntry 时显示🎫，否则干净
- [ ] 🎫 功能不受影响
- [ ] 无残留死代码
