# 抽取 utils/recommend.js 与共享组件 — 技术设计

> 任务：`06-24-recommend-module`。配合 `prd.md`。

## 1. 架构与边界

```
utils/recommend.js          ← 共享纯工具（detectScene/format*/pad2）
config/scenes.js            ← SCENE_NAMES（③ 产物，本任务 import 对齐）
components/restaurant-card/ ← 推荐卡片组件
components/coupon-float/    ← 浮动红包组件
   ↑ 使用
pages/index/index.js  /  pages/mystery/mystery.js  （退化为外壳，调用共享工具+组件）
```

本任务只抽**已重复的纯工具 + UI**，不引入 `recommend(pois,scene,{mode})` 主入口（跨 ③④⑤，控制范围）。

## 2. `utils/recommend.js` 契约

```js
// 时段 → 场景名（迁移自 index.js:90-97 / mystery.js:12-19，二者逐字相同）
function detectScene() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) return '早餐';
  if (hour >= 10 && hour < 14) return '午餐';
  if (hour >= 14 && hour < 17) return '下午茶/饮品';
  if (hour >= 17 && hour < 21) return '晚餐';
  return '夜宵';
}

// 距离格式化（以 index.js 版为准：' km'/' m'）
function formatDistance(d) {
  if (d == null) return '';
  return d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
}

// 评分格式化（'无评分' 兜底）
function formatRating(r) {
  return r ? r.toFixed(1) : '无评分';
}

// 时间补零（统一命名 pad2，废弃 padHour/pad2 双名）
function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

module.exports = { detectScene, formatDistance, formatRating, pad2 };
```

**口径决策**：以 index 版为准。验证：mystery 现有 formatDistance/formatRating 实现与 index **完全相同**（mystery.js:25-32 ≡ index.js:100-107），无差异，直接合并零风险。

## 3. 组件契约

### `components/restaurant-card/`
**作用**：渲染单张推荐卡片（名称/品类/距离/评分/人均/理由 + 导航/复制/🎫 按钮）。
- **目录**：`components/restaurant-card/{index.js,index.wxml,index.wxss,index.json}`
- **props（properties）**：`card`（Object，即 buildCardView 产物：`{poi_id,name,type,address,location,distanceText,ratingText,costText,reason,shopEntry}`）
- **events（triggerEvent）**：
  - `navigate`（导航，携带 location）
  - `copyaddr`（复制地址，携带 address）
  - `coupon`（🎫，携带 poi_id/name）
- 页面侧 `bind:navigate="onOpenNav"` 等，handler 调原有逻辑（导航/复制/commercialHelper）。
- **wxss**：从 `index.wxss` / `mystery.wxss` 提取卡片样式集中到组件 wxss。

### `components/coupon-float/`
**作用**：🧧 浮动按钮 + 底部 action-sheet（平台红包入口）。
- **props**：`visible`（Boolean，是否展示）、`platforms`（Array，`getPlatformButtons()` 结果）
- **events**：`open`（携带 entry）、`toggle`（切换 action-sheet）
- 内部用 `commercialHelper.getPlatformButtons()` 取平台列表（或由页面传入）。

### `app.json` 注册
```json
"usingComponents": {
  "restaurant-card": "/components/restaurant-card/index",
  "coupon-float": "/components/coupon-float/index"
}
```
（全局注册；两页直接用 `<restaurant-card card="..."/>` `<coupon-float .../>`）

## 4. 迁移映射

| 原位置 | 原 | 迁移目标 |
|--------|----|---------|
| index.js:90-97 / mystery.js:12-19 | `detectScene` | `utils/recommend.js`，两页 import |
| index.js:100-107 / mystery.js:25-32 | `formatDistance/formatRating` | `utils/recommend.js` |
| index.js padHour / mystery.js pad2 | 时间补零 | `utils/recommend.js` `pad2`（统一名）|
| index.wxml 卡片块 / mystery.wxml 卡片块 | 内联卡片 | `restaurant-card` 组件 |
| index.wxml:98-121 / mystery.wxml:119-142 | 浮动红包 | `coupon-float` 组件 |
| index.js onOpenNav/onCopyAddr / mystery.js 同 | 卡片动作 | 下沉到组件 triggerEvent，页面 bind |
| index.js onOpenPlatform/onToggleCouponPicker / mystery.js 同 | 红包动作 | `coupon-float` 组件 + triggerEvent |

**import 源对齐**：两页 `require('config/sceneKeywords.js')` 的 `SCENES` 改为 `require('config/scenes.js')` 的 `SCENE_NAMES`（③ 产物）。**这是与 ③ 的唯一交点**，合并时以 ③ 的 `config/scenes.js` 为准。

## 5. 与 ③⑤ 的合并边界（worktree 并行用）

| 文件 | ③ 改的区域 | ④ 改的区域 | ⑤ 改的区域 |
|------|-----------|-----------|-----------|
| `pages/index/index.js` | SCENE_TONE_MAP(10-17)、sceneMultiplier(37-42)、_generateReason sceneTone(565-572) | detectScene(90-97)、format*(100-107)、卡片/红包 handler、SCENES import | callAIRecommend(335-445)、parseRecommendJson(125-206) |
| `pages/mystery/mystery.js` | SCENES import(8) | detectScene(12-19)、format*(25-37)、卡片/红包 handler | callMysteryAIReason(80-140) |
| `utils/mysteryBox.js` | timeAwareMultiplier/detectPoiScene/isSceneMismatch/conflicts | （④ 不动 mysteryBox）| （⑤ 不动 mysteryBox）|

**区域不重叠**，合并按文件 region 解冲突（git 三方合并通常能自动处理 import 行与不同函数块；仅同区域才手动解）。

## 6. 验证

- `node -c` 语法校验三个新建组件 + recommend.js + 改动页面。
- 行为：同一时刻 `detectScene()` 两页一致；卡片/红包 UI 与操作回归（人工/逻辑核对，无自动化框架）。
- `parseRecommendJson.test.js` 11 项全过（④ 不动解析，但确保未误伤）。
- grep 确认两页无本地 `detectScene`/`formatDistance`/`formatRating`/`padHour`/`pad2` 残留。

## 7. 风险与回滚

- **风险**：组件抽取改 WXML 结构 → 样式/事件绑定错位。缓解：props/events 契约明确，wxss 整体迁入组件。
- **回滚**：单 commit revert（无数据迁移）。
- **跨任务**：④ 是三任务中改动面最大（新增 2 组件 + 改两页 WXML），合并时优先合并 ③⑤，最后合 ④ 并人工核对 WXML。
