# 抽取共享评分模块 utils/scoring.js

> 父任务：`06-24-rec-domain-refactor`（推荐域规格化重构）
> 前置依赖：无（与 ① poi-id-stable 平级，① 已归档）
> 后置约束：③ scene-system 的权重 profile、④ recommend-module 都将复用本模块。

## Goal

把评分原语 `distanceScore / qualityScore` 从**三处逐字复制**收敛为 `utils/scoring.js` 一份，并提供参数化的 `scoreCandidates(pois, { weights, matcher, excludeIds })`，让首页（求稳 0.5/0.5）和盲盒（求惊喜 0.4/0.4/0.2）共用同一份**规格**、只传不同**参数**。

对应老许方法论 slide5「场景广，不等于规格杂」、slide6「功能堆叠是成本」、slide7「复杂往往意味着抽象失败」——把被混淆的「权重（参数）」与「函数（规格）」拆开。

## User Value

- 消除 drift 隐患：当前 `distanceScore/qualityScore` 在 index.js、mysteryBox.js 逐字一致，一旦改公式必须同步多处，极易漏改导致两页评分口径不一致。
- 为 ③ 场景系统、④ recommend 统一入口提供可注入权重的地基。

## Current Context（代码证据）

**重复的原语（本次抽取目标）：**
- `pages/index/index.js:29-35` —— `distanceScore(d)=Math.exp(-d/800)`、`qualityScore(r)=r?r/5.0:0.3`
- `utils/mysteryBox.js:11-18` —— **逐字相同**的两份（注释甚至写「复用 index.js 既有公式」）
- 已删的 `cloudfunctions/recommend/index.js` —— 第三份（git 历史残留，已不在工作树，无需处理）

**不应过度合并的部分（保持页面各自持有）：**
- 首页 `sceneMultiplier`（match=1.0/no-match=**0.5**，硬砍半）—— index.js:37-42
- 盲盒 `timeAwareMultiplier`（match=1.2/no-match=**0.85**，软引导）+ `longTailBonus`（连锁 0.2/特色 1.0）—— mysteryBox.js:31-47
- 这两套「乘数」语义不同、经不同任务调过（06-21 弱化过 mystery 的时段惩罚），**本次只抽原语 + 参数化 scoreCandidates，不动乘数逻辑**。乘数逻辑的统一留给 ③。

**index.js 当前的 scoreCandidates（pages/index/index.js:44-59）：**
- `pois.map((poi) => { base = 0.5*d + 0.5*q; score = base*sceneMultiplier; poiId=makePoiId(poi); if excluded score*=0.6; ... })`
- poi_id 已在 ① 改用 `makePoiId`。

**mysteryBox.js 当前的 calculateWeight（utils/mysteryBox.js:74-79）：**
- `base = 0.4*d + 0.4*q + 0.2*longTail; return base * timeAwareMultiplier`

## Confirmed Design Decisions

1. **抽取范围 = 原语 + 参数化聚合，不含乘数。** `utils/scoring.js` 导出：
   - `distanceScore(distance)` —— 指数衰减，原样迁移。
   - `qualityScore(rating)` —— 原样迁移。
   - `scoreCandidates(pois, opts)` —— 通用打分聚合：
     - `opts.weights` = `{ d, q, longtail? }` 权重对象（首页传 `{d:0.5,q:0.5}`，盲盒传 `{d:0.4,q:0.4,longtail:0.2}`）。
     - `opts.bonus(poi)` = 可选长尾加成函数（首页不传=不参与；盲盒传 `longTailBonus`）。
     - `opts.matcher(poi)` = 可选场景乘数函数（首页传 `sceneMultiplier`，盲盒传 `timeAwareMultiplier`）。
     - `opts.excludeIds` = 排除集（命中后 `score*=0.6`，沿用首页既有惩罚系数）。
     - 返回 `[{ poi_id, poi, score, matched }]`，`poi_id` 用 `makePoiId`。
   - 注：盲盒用的是**加权随机**而非排序 topN，所以盲盒消费的是 `score`（权重）本身，不消费排序；`scoreCandidates` 返回带 score 的候选即可，盲盒在其上做 `weightedRandomPick`。

2. **不过度抽象乘数与 topN。** `topN / topNWithExplore` 是首页专属（盲盒走加权随机），保留在 index.js。`longTailBonus / timeAwareMultiplier / sceneMultiplier / qualifyFilter / CHAIN_KEYWORDS` 保持各自文件持有，本次不迁。

3. **mysteryBox 保留 `distanceScore/qualityScore` 的 re-export**（它已 export 这两个，见 mysteryBox.js:225-227）——为避免破坏外部 import，mysteryBox 改为从 scoring.js 引入后再 re-export，行为不变。

4. **行为等价是硬约束。** 同一 POI + 同一权重 profile 下，重构前后 score 数值必须完全一致（纯搬运，不改公式/系数）。

## Requirements

### 新建 `utils/scoring.js`
- 导出 `distanceScore(distance)`、`qualityScore(rating)`（从 index.js/mysteryBox.js 迁移，公式不变）。
- 导出 `scoreCandidates(pois, { weights, bonus, matcher, excludeIds })`：
  - `base = weights.d*distanceScore + weights.q*qualityScore + (weights.longtail||0)*(bonus?bonus(poi):0)`
  - 若 `matcher` 提供：`score = base * matcher(poi)`，否则 `score = base`
  - `poi_id = makePoiId(poi)`（从 util.js 引入）
  - `excludeSet` 命中则 `score *= 0.6`
  - `matched` = matcher 是否存在/是否命中（供首页 topNWithExplore 划档；无 matcher 时视为 true）
  - 返回 `[{ poi_id, poi, score, matched }]`

### `pages/index/index.js`
- 删除本地 `distanceScore/qualityScore`（:29-35），从 `utils/scoring.js` 引入。
- `scoreCandidates`（:44-59）改为调用 `scoring.scoreCandidates(pois, { weights:{d:0.5,q:0.5}, matcher: sceneMultiplier, excludeIds })`。
- `topN/topNWithExplore`、`sceneMultiplier` 保留在本文件。

### `utils/mysteryBox.js`
- 删除本地 `distanceScore/qualityScore`（:11-18），从 `utils/scoring.js` 引入。
- `calculateWeight` 改为：`base = 0.4*d + 0.4*q + 0.2*longTailBonus`（数值不变，只是 d/q 来自共享函数）。
- 保留 `longTailBonus/timeAwareMultiplier/qualifyFilter/CHAIN_KEYWORDS`。
- re-export `distanceScore/qualityScore`（维持现有 export 契约不变）。

## Acceptance Criteria

### 结构
- [ ] 新建 `utils/scoring.js`，导出 `distanceScore / qualityScore / scoreCandidates`
- [ ] `pages/index/index.js` 与 `utils/mysteryBox.js` 不再有本地 `distanceScore/qualityScore` 定义（grep 确认）
- [ ] 两处均从 `utils/scoring.js` 引入评分原语

### 行为（不回归，纯搬运）
- [ ] 同一 POI 数组 + 首页权重（0.5/0.5），重构前后 `scoreCandidates` 返回的 score 数值逐项相等
- [ ] 同一 POI + 盲盒权重（0.4/0.4/0.2），`calculateWeight` 数值不变
- [ ] 首页 topN/topNWithExplore 排序结果不变（候选多样性、探索位逻辑不受影响）
- [ ] 盲盒加权随机分布不变（qualifyFilter/timeAwareMultiplier/longTailBonus 未动）
- [ ] excludeIds 命中惩罚（×0.6）仍生效
- [ ] `pages/index/parseRecommendJson.test.js` 仍 11 项全过（本次不动解析）
- [ ] 现有 mysteryBox 单测/调用方（mystery.js）行为不变

### 契约
- [ ] mysteryBox re-export 的 `distanceScore/qualityScore` 仍可用（不破坏外部 import）

## Out of Scope

- 场景乘数统一（sceneMultiplier vs timeAwareMultiplier）→ 子任务 ③
- topN/topNWithExplore 抽离到共享 → 子任务 ④（recommend-module）
- longTailBonus/CHAIN_KEYWORDS/qualifyFilter 迁移 → 留在盲盒，本次不动
- 评分公式/系数本身的业务调参 → 本次只搬运，不改数值

## Open Questions

（已全部解决，无遗留问题）

## Notes

- 轻量任务，PRD-only 即可。
- 关键纪律：**只抽原语 + 参数化聚合，不动乘数**。避免把 ③④ 的活提前做了导致本次范围膨胀、回归风险上升。
- 行为等价验证手段：对一组固定 POI 样本，重构前后分别打印 score 数组对比（node 脚本即可，不必引入测试框架）。
