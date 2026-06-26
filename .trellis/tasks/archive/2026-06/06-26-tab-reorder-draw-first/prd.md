# Tab 结构调整：抽签决定前置

## 背景

PRD §3.1：当前 Tab1=AI甄选、Tab2=盲盒惊喜。App 主打"今天吃什么"的决策属性，应将"抽签决定"前置为默认入口，强化"AI 帮你定"的差异化定位，避免一进来像美团/点评的筛选列表。

## 需求

### 1. Tab 顺序与命名调换

- Tab1：`抽签决定`（对应 `pages/mystery/mystery`）
- Tab2：`AI甄选`（对应 `pages/index/index`）

### 2. 默认进入抽签 Tab

- App 启动默认进入"抽签决定"（mystery）页

### 3. 各页 tabBar 选中索引修正

- mystery 页 onShow 中 `getTabBar().setData({ selected })` 由 1 改为 0
- index 页 onShow 中 `getTabBar().setData({ selected })` 由 0 改为 1

### 4. 文案连带修改

- mystery 页未授权态文案"开启你的美食盲盒"等改为"抽签"语境（mystery.wxml 空状态文案）
- 确认无其他"盲盒惊喜"字样残留（custom-tab-bar、app.json、页面文案）

## 涉及文件

- `app.json`（pages 顺序、tabBar.list）
- `custom-tab-bar/index.js`（list 顺序与 text）
- `pages/mystery/mystery.js`（selected 索引）
- `pages/index/index.js`（selected 索引）
- `pages/mystery/mystery.wxml`（未授权态文案，连带）

## 验收标准

- [ ] App 启动默认进入"抽签决定"Tab，tabBar 高亮在第一个
- [ ] Tab 顺序为：抽签决定 / AI甄选
- [ ] 切换两个 Tab，底部高亮指示正确无错位
- [ ] 抽签页未授权态文案无"盲盒惊喜"残留字样

## Notes

- pages 顺序与 tabBar.list 顺序需保持一致，否则默认进入页与 tabBar 高亮会错位。
- `app.json` 的 `tabBar.list` 与 `custom-tab-bar/index.js` 的 `list` 是两处独立配置，都要改（custom 模式下 tabBar.list 仍需存在占位，custom-tab-bar 才能渲染）。
