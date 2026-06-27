# 砍掉AI甄选手动筛选栏

## 背景

AI 决策引擎重构的前置任务。审计结论：**手动筛选栏违背 AI 决策定位。**

- AI 甄选的定位是"**AI 帮你筛**"，加手动筛选栏 = 让用户自己挑 = 否定 AI。
- 三个筛选维度（人均/距离/类别）与场景栏（早餐/午餐/...）高度重叠，重复造轮子。
- 手动筛选让 AI 甄选变成"弱化版美团"（PRD §1 吐槽的同质化问题加剧）。

重构后甄选将由 AI 权重引擎接管"筛选"（场景切换时 AI 调权重），手动筛选栏彻底移除。

## 范围

### 移除内容
- `utils/poiFilter.js`（整个文件删除）
- `pages/index/index.wxml` 的 filter-bar / filter-panel-mask / filter-panel（下拉面板 UI）
- `pages/index/index.wxss` 的 .filter-bar / .filter-tab* / .filter-panel* / .filter-option* 全部样式
- `pages/index/index.js` 的 filterGroups / filters / activeFilter* data 字段 + onToggleFilter / onPickFilter / onCloseFilter / _closeFilterPanel 方法
- `callRecommend` / `_useFallbackRecommend` 里的 `filterPois` 调用（恢复直接用原始 pois）

### 保留内容
- `utils/poiFilter.js` 的设计文档（`06-26-ai-pick-filter-bar` 任务归档）保留在 git 历史，以防未来场景变化需要重新评估
- 场景栏（早餐/午餐/...）保留——它是天然的筛选维度，且将由 AI 权重引擎增强

## 验收标准

- [ ] `utils/poiFilter.js` 文件删除
- [ ] index 页无任何筛选相关 UI / data / 方法 / 样式
- [ ] `callRecommend` / `_useFallbackRecommend` 不再调 filterPois，直接用 pois
- [ ] grep `filterPois|poiFilter|filterGroups|activeFilter|onToggleFilter|onPickFilter` 零残留
- [ ] 推荐功能正常（场景栏切换、换一批、loading、兜底逻辑不受影响）
- [ ] 语法校验通过

## Notes

- 简单任务，PRD-only，无需 design。
- 执行顺序：本任务先做（清理战场），再做抽签 AI 调权重。
- 砍掉后甄选暂时回到"距离+评分排序"现状，待子任务3（少而准）重构为 AI 决策。
