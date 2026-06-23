# Journal - WhatToEat-AI (Part 1)

> AI development session journal
> Started: 2026-06-06

---



## Session 1: 盲盒推荐算法 review 与时段加权优化

**Date**: 2026-06-21
**Task**: 盲盒推荐算法 review 与时段加权优化
**Branch**: `main`

### Summary

Review 盲盒推荐算法并修复两类问题：①06-14 review 遗留的4项（poi_id改稳定复合键、探索分支改中段探索、连锁降权0.2、无评分门槛放宽至1500m）；②新增06-21任务处理时段加权过强+关键词表覆盖不全，系数由1.3/0.7调为1.2/0.85并扩充五场景品类词，修复近距好店被反超问题（面馆权重0.630→1.080）。顺带发现pages/index/index.js仍有同类poi_id下标bug，留待后续任务。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e9d7655` | (see git log) |
| `1da5ace` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

---

## Session 2: AI 甄选与盲盒推荐体验提质

**Date**: 2026-06-24
**Task**: AI甄选与盲盒推荐体验提质 (`06-24-ai-recommend-experience`)
**Branch**: `main`

### Summary

围绕 AI 甄选四个核心价值（理由/免责/被理解/惊喜），对首页 AI 推荐与盲盒推荐两端做体验提质，并修复推荐卡片店铺类型全部显示为"餐饮"的缺陷。共五处改动：①首页 AI prompt 加 time/weekday 语境 + 人设升级；②fallback 文案口语化 + banner 软化（不暴露降级）；③excludeIds 上限 6→15 + exclude 多时候选 7→10；④`normalizePoiType` 改取末段细分（"中式快餐"而非"餐饮"）；⑤盲盒探索档（30%）接入 AI 惊喜理由，与开盒动画并行、失败回退模板。

### Main Changes

- `pages/index/index.js`：prompt 上下文增强、`padHour/padMinute`、`_generateReason` 重写、exclude 15 + 候选动态扩
- `pages/index/index.wxml`：fallback banner 文案软化
- `utils/util.js`：`normalizePoiType` 取末段细分 + `POI_TYPE_NOISE_SEGMENTS`
- `utils/mysteryBox.js`：`mysteryBoxRecommend` 返回 `fromExplore`
- `pages/mystery/mystery.js`：`buildMysteryPrompt` + `callMysteryAIReason`，探索档并行 AI、`_revealMysteryBox` async

### Git Commits

| Hash | Message |
|------|---------|
| (see git log) | feat(recommend): AI 甄选与盲盒体验提质 |

### Testing

- [OK] `node --check` 全部通过
- [OK] `parseRecommendJson.test.js` 11 项全过
- [OK] `mysteryBoxRecommend` 200 次模拟探索占比 30.5%（符合 epsilon=0.3）
- [OK] 池耗尽返回 null、场景不匹配门控正确

### Status

[OK] **Completed**

### Next Steps

- 未做项（归第四梯队）：天气感知场景检测、换一批负反馈对话


## Session 2: 推荐域规格化重构·子任务①poi_id稳定性

**Date**: 2026-06-24
**Task**: 推荐域规格化重构·子任务①poi_id稳定性
**Branch**: `feat/ai-recommend-experience`

### Summary

源于老许《怎么做好产品设计》分享的方法论诊断：建父任务 rec-domain-refactor + 5 子任务树；完成子任务①——首页 poi_id 由数组下标 String(idx) 改为稳定唯一标识（高德 id 优先/ location|name 兜底），getPoi 透传 poi_id、util.js 统一 makePoiId、index/mysteryBox 两页契约一致，修复换一批去重失效潜在 bug，回归测试 11 项全过，spec 写入 POI 身份契约。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `980130f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: 推荐域规格化重构·子任务②共享评分模块

**Date**: 2026-06-24
**Task**: 推荐域规格化重构·子任务②共享评分模块
**Branch**: `feat/ai-recommend-experience`

### Summary

完成子任务②：抽取 utils/scoring.js，把 distanceScore/qualityScore 从 index.js+mysteryBox.js 两份复制收敛为单一事实源，并提供参数化 scoreCandidates(pois,{weights,bonus,matcher,excludeIds})，首页传 {d:0.5,q:0.5}+sceneMultiplier、盲盒传 {d:0.4,q:0.4,longtail:0.2}+timeAwareMultiplier。只抽原语+参数化聚合，不动乘数语义（留给③）。行为等价已验证：首页4个POI score逐项相等、盲盒calculateWeight数值相等、回归测试11项全过、re-export契约保留。spec 写入评分原语单一事实源约定。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ecd8a11` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
