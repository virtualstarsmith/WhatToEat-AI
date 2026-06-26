# 盲盒选中态修复提交

## 背景

PRD §3.4 / §5 验收点 3：盲盒历史列表点击切换店铺时，底部选中指示器必须同步变化。

该修复**已在工作区完成**（未提交），本任务为收尾提交。

## 现状（工作区已有 diff）

- `pages/mystery/mystery.js`：新增 `mysteryBox.currentRank` 字段；开盒（`_revealMysteryBox`）和重开历史（`onReopenHistory`）时同步更新 `currentRank`
- `pages/mystery/mystery.wxml`：`wx:key` 从 `poi_id` 改为 `rank`（列表为倒序 concat，key 必须稳定）；`history-card` 加 `history-card-active` 选中态 class
- `pages/mystery/mystery.wxss`：新增 `.history-card-active` 样式；箭头 `›` 改为 `↑` 圆形按钮（语义修正：右侧非"进入详情"，而是"回顶部展示"）

## 需求

- 将工作区已有改动作为一个独立提交，不与其他任务（Tab 重构、筛选栏）混在一起

## 验收标准

- [ ] 工作区 diff 内容完整、无遗漏
- [ ] 提交信息语义清晰（如 `fix(mystery): 历史列表选中态与上方展示同步`）
- [ ] 提交后工作区干净（无该任务相关残留）

## Notes

- 本任务为 PRD-only 轻量任务（改动已存在，仅提交）。
- 关键点：`wx:key="rank"` 的变更原因是列表用 `concat` 倒序拼接，`poi_id` 在重开历史时可能重复，`rank`（开盒序号）才是稳定唯一键。
