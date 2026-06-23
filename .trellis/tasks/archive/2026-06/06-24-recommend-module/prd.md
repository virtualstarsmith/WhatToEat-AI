# 抽取 utils/recommend.js 与共享组件

> 父任务：`06-24-rec-domain-refactor`
> 前置依赖：逻辑上独立，但本任务删除/改动 `detectScene`、format 工具、卡片/红包 UI，这些与 ③⑤ 在 `index.js`/`mystery.js` 的**不同函数区域**，worktree 并行、合并时按区域解冲突。
> 跨任务耦合点：`mystery.js:8` 与 index 的 `detectScene` 当前 import `SCENES` 自 `config/sceneKeywords.js`（③ 会删它、改 `config/scenes.js`）。本任务把 `detectScene` 抽到共享模块后，import 源**统一指向 `config/scenes.js`**（SCENE_NAMES），与 ③ 的产物对齐——合并时以 ③ 的 `config/scenes.js` 为准。

## Goal

把首页与盲盒页**重复的共享逻辑与 UI** 收敛：`detectScene()`（两页逐字相同）、format 工具（`formatDistance/formatRating/padHour/pad2`，两页各一份且略有差异）、卡片动作处理（导航/复制地址，两页近似）、浮动红包按钮 UI（两页 WXML 重复）。

对应老许方法论 slide9「看产品别盯单点，要看它承载的系统」、slide12「技术形态只是外壳，问题域才是产品本体」——两个页面应是同一产品规格的两种 UI 外壳，而非各自重写基础设施。

## User Value

- 消除 `detectScene` 双份复制（漂移隐患：改一处忘另一处会导致两页时段判断不一致）。
- format 工具单一事实源，两页格式化口径统一。
- 卡片与红包抽成组件，两页 UI 一致且可独立演进。

## Current Context（代码证据）

**detectScene 双份（逐字相同）：**
- `pages/index/index.js:90-97`
- `pages/mystery/mystery.js:12-19`
- 注释 `mystery.js:11` 明写「与 index.js 保持一致」——典型复制而非共享。

**format 工具（两份，签名/实现略异）：**
- `index.js:100-107` `formatDistance(d)`（`d>=1000 ? (d/1000).toFixed(1)+' km' : Math.round(d)+' m'`）、`formatRating(r)`（`r?r.toFixed(1):'无评分'`）
- `mystery.js:25-32` 同名同体 `formatDistance/formatRating`
- `index.js` `padHour` vs `mystery.js` `pad2`（功能相同，命名不同）
- `mysteryBox.js:171-178` 另有 `formatDistanceZh/formatRatingZh`（中文版，盲盒专属，**不合并**）

**卡片动作（两页近似重复）：**
- `index.js` `onOpenNav`/`onCopyAddr`（:595+）
- `mystery.js` 同名处理（:346+）

**浮动红包 UI（WXML 双份）：**
- `index.wxml:98-121` 🧧 浮动按钮 + action-sheet
- `mystery.wxml:119-142` 近似重复块
- 两页 JS 各有 `onOpenPlatform`/`onToggleCouponPicker`（index.js:641+、mystery.js:370+）

**buildCardView（index.js:109-123）** 构造卡片视图，盲盒侧在 mystery.js 内联构造——结构近似。

## Confirmed Design Decisions

1. **`utils/recommend.js`** 收纳共享逻辑（产品本体的一部分）：
   - `detectScene()`（时段→场景名）
   - `formatDistance(d)` / `formatRating(r)`（统一两页口径）
   - `pad2(n)`（时间补零，统一命名，废弃 padHour/pad2 双名）
   - 暂不在此放 `recommend(pois,scene,{mode})` 主入口——主入口涉及打分+选择+AI，跨 ③④⑤，避免本任务过大；本任务只抽**已重复的纯工具**。
2. **format 工具口径**：以 `index.js` 现有实现为准（`' km'/' m'`、`'无评分'`），盲盒改为引用共享版。若 mystery 当前展示形态依赖差异（实际无差异），以共享版为准。
3. **自定义组件**：抽 `components/restaurant-card/`（推荐卡片）与 `components/coupon-float/`（浮动红包 + action-sheet）。两页改用组件，删除内联 WXML 与重复 handler。
4. **import 源对齐**：`detectScene`/组件中需要的场景名列表，统一从 `config/scenes.js`（③ 产物）取 `SCENE_NAMES`，不再 import `config/sceneKeywords.js`。
5. **不过度合并**：`formatDistanceZh/formatRatingZh`（盲盒中文版）、`buildMysteryPrompt`、盲盒专属文案留 mysteryBox/mystery，不迁。

## Requirements

### 新建 `utils/recommend.js`
- 导出 `detectScene()`、`formatDistance(d)`、`formatRating(r)`、`pad2(n)`。

### `pages/index/index.js` / `pages/mystery/mystery.js`
- 删除本地 `detectScene`/`formatDistance`/`formatRating`/`padHour`/`pad2`，改从 `utils/recommend.js` 引入。
- 卡片视图改用 `restaurant-card` 组件；浮动红包改用 `coupon-float` 组件；删除内联 WXML 块与重复 handler（onOpenNav/onCopyAddr 逻辑下沉到组件或保留页面但调用共享 helper）。
- `SCENES` import 改为从 `config/scenes.js` 取 `SCENE_NAMES`。

### 新建组件
- `components/restaurant-card/`：接收 card 数据，渲染名称/品类/距离/评分/人均/理由，含导航/复制/🎫 按钮事件。
- `components/coupon-float/`：🧧 浮动按钮 + action-sheet，含 `getPlatformButtons()` 平台列表。

### app.json
- 注册两个自定义组件（`usingComponents` 或按需引入）。

## Acceptance Criteria

### 结构
- [ ] 新建 `utils/recommend.js`（detectScene/formatDistance/formatRating/pad2）
- [ ] 两页不再有本地 `detectScene`/`formatDistance`/`formatRating`/`padHour`/`pad2`（grep 确认）
- [ ] 新建 `restaurant-card`、`coupon-float` 组件，`app.json` 注册
- [ ] 两页 WXML 删除内联卡片/红包块，改用组件

### 行为（不回归）
- [ ] 时段检测：首页/盲盒 detectScene 返回值与重构前一致（同一时刻两页一致）
- [ ] 卡片展示：距离/评分/品类/文案格式不变
- [ ] 卡片操作：导航/复制地址/🎫 行为不变
- [ ] 浮动红包：平台按钮显隐与跳转不变
- [ ] `pages/index/parseRecommendJson.test.js` 仍 11 项全过

### 跨任务对齐
- [ ] 不再 import `config/sceneKeywords.js`（改 `config/scenes.js`），合并时不与 ③ 冲突

## Out of Scope

- `recommend(pois,scene,{mode})` 统一主入口 → 跨 ③④⑤，本任务只抽已重复的工具
- AI 调用层 → ⑤
- 场景匹配/规格 → ③
- `formatDistanceZh/formatRatingZh`/盲盒专属文案 → 留盲盒

## Open Questions

（无；format 口径以 index 版为准、组件下沉策略已定）

## Notes

- 复杂任务，需 `design.md`（组件 props/事件契约、import 迁移映射、与 ③⑤ 的合并边界）。
- 关键纪律：只抽**已重复**的纯工具与 UI，不引入新的主入口，控制合并冲突面。
