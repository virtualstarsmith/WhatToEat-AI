# 推荐域规格化重构

## Goal

把首页（AI 甄选）与盲盒页背后那套「评分 + 场景 + AI 调用」从散落在两个 `Page` 的 feature-factory 形态，重构为一个共享的「产品规格」域模块。对应老许《怎么做好产品设计》的核心方法论：**用方法论把变化收敛，而不是每加一个场景/用户故事就改多处代码。**

本任务为**父任务**，只持有需求集、子任务地图、跨子任务验收与最终集成 review，不直接实现。

## Background（为什么要做）

文档核心论点映射到本项目的诊断：

- **CPS 分销层（`config/commercial.js` + `utils/commercialHelper.js`）已经是合格的「抽象工厂」**——新增平台只改 config，零代码。这是我们要在推荐域复刻的范式。
- **盲盒算法（`utils/mysteryBox.js`）也是合格抽象**——纯函数、可单测。证明团队有能力做抽象，只是没推到别处。
- **但推荐域（评分 / 场景 / AI 调用）是典型 feature-factory**：原语三份复制、场景散落 5 处硬编码、匹配靠裸 `indexOf` 靠手工塞词打补丁、poi_id 不稳定。

## Current Context（代码证据）

**问题 A：评分原语重复三份（抽象失败）**
- `pages/index/index.js:29-35` 的 `distanceScore / qualityScore`
- `utils/mysteryBox.js:11-18` 同名同体逐字复制
- 已删的 `cloudfunctions/recommend/index.js` 是第三份（git 历史残留）
- `index.js:26-28` 注释承认两套权重「有意区分」，但被区分的是**权重**（0.5/0.5 vs 0.4/0.4/0.2），函数体却整份复制——权重是参数，函数是规格，二者混为一谈。

**问题 B：场景系统散落 5 处硬编码（最大痛点）**
- `config/sceneKeywords.js:4-14` 关键词表 + `:14` 场景列表
- `pages/index/index.js:10-17` 语气色 `SCENE_TONE_MAP`
- `pages/index/index.js:576-583`（_generateReason）场景文案表
- `utils/mysteryBox.js:174-181` 「严重不匹配」冲突矩阵（只覆盖 6 场景中的 3 个）
- 匹配算法是裸 `indexOf` 子串匹配（`index.js:41`、`mysteryBox.js:46`），两套语义打架：index 用 match=1.0/no-match=**0.5**（硬砍半），mystery 用 1.2/0.85（软调）。06-21 任务只能靠**手工往列表塞词**打「面馆匹配面食」的补丁。

**问题 C：两个 Page 是独立孤岛，共享逻辑靠复制**
- `detectScene()`（`index.js:90-97` ≡ `mystery.js:12-19`）
- 卡片动作处理、浮动红包按钮 WXML、AI 流式调用逻辑、`formatDistance/formatRating/padHour/padMinute` 全部双份存在
- 盲盒另起炉灶搞了 `formatDistanceZh/formatRatingZh`（`mysteryBox.js:186-193`）

**问题 D：poi_id 不稳定，违反自家 spec（潜在 bug）**
- 首页 `index.js:52` `const poiId = String(idx)` 用**数组下标**当 poi_id
- 盲盒 `mysteryBox.js:67-69` 用稳定 `location|name`
- `06-14 design.md:202` 明确写「poi_id 必须稳定唯一标识，禁止用数组下标」——**首页违反自己的 spec**
- 后果：换一批时 POI 池顺序一变，下标错位，去重失效/误删

**问题 E：AI 调用层未沉淀**
- `cloudfunctions/recommend/` 已删，AI 调用迁到客户端（`wx.cloud.extend.AI.createModel`），流式收集逻辑在两页各复制一份（`index.js:376+` ≡ `mystery.js:80-119`），提示词内联在页面
- `parseRecommendJson.test.js` 因 `index.js` 是 `Page({...})` 注册而非模块，只能**把解析函数整份抄进测试文件**（见其 header 注释）

## Confirmed Design Decisions

1. **父/子结构**：1 父 + 5 子。父任务不实现，只做地图、跨子任务验收、最终集成 review。
2. **依赖序执行，不并行**：子任务有 A→B→C 的依赖链（见下方任务地图），按序推进，每个子任务归档后再启动下一个。
3. **每个子任务独立可验证**：各自有 prd + 验收 + check + 提交 + 归档；复杂子任务（③④⑤）在 brainstorm 阶段决定是否补 design.md / implement.md。
4. **行为不变是硬约束**：重构期间首页/盲盒对用户可见的推荐结果（排序、去重、文案、AI 输出）必须保持等价，通过回归验证。

## Requirements（父任务级）

### 子任务地图

| 序 | 子任务 | slug | 对应 | 依赖 | 复杂度 |
|----|--------|------|------|------|--------|
| ① | 修复 poi_id 稳定性 | `06-24-poi-id-stable` | D | 无 | 轻（PRD-only）|
| ② | 抽 `utils/scoring.js` 共享评分 | `06-24-scoring-module` | A | 无 | 轻 |
| ③ | 场景系统单一事实源 + 匹配算法升级 | `06-24-scene-system` | B | ② | 复杂（需 design.md）|
| ④ | 抽 `utils/recommend.js` + 共享组件 | `06-24-recommend-module` | C | ②③ | 复杂（需 design.md）|
| ⑤ | 抽 `utils/aiRecommend.js` 统一 AI 层 | `06-24-ai-recommend` | E | ④ | 复杂（需 design.md）|

### 执行序（依赖链）

```
① poi-id-stable   （独立，最小，修潜在 bug，先做）
② scoring-module  （评分原语共享，是 ③④ 的地基）
   └→ ③ scene-system          （依赖 ② 的权重 profile）
        └→ ④ recommend-module  （把 ②③ 收进共享域模块 + 组件）
             └→ ⑤ ai-recommend  （依赖 ④ 的产物）
```

> 父/子结构不是依赖系统：每个子任务在其自身 prd 中写明 ordering 与前置条件（见 workflow.md 约定）。

### 跨子任务共享约束（写进每个子任务 prd）

- **行为等价**：重构不改变用户可见的推荐排序、去重、文案、AI 输出语义。
- **不并行**：上一个子任务归档后再 start 下一个。
- **poi_id 契约**：自 ① 完成后，所有 poi_id 必须是稳定唯一标识（`location|name` 或高德 poi_id），禁止数组下标。

## Acceptance Criteria（父任务，全部子任务完成后）

### ① poi_id 稳定性（D）
- [ ] 首页删除 `String(idx)`，改用与盲盒一致的稳定键
- [ ] 换一批去重在 POI 池顺序变化后仍正确
- [ ] 首页/盲盒 poi_id 语义统一，符合 06-14 design.md:202

### ② 共享评分模块（A）
- [ ] 新建 `utils/scoring.js`，导出 `distanceScore / qualityScore / scoreCandidates(pois, scene, { weights, excludeIds })`
- [ ] 首页传 `{d:0.5,q:0.5}`，盲盒传 `{d:0.4,q:0.4,longtail:0.2}`
- [ ] 三份逐字复制的 `distanceScore/qualityScore` 收敛为一份
- [ ] 首页/盲盒打分行为回归通过

### ③ 场景系统（B）
- [ ] 新建 `config/scenes.js` 单一事实源，每个场景一份完整规格（关键词 + 语气色 + 文案 + 权重 profile + 冲突规则）
- [ ] 散落 5 处（sceneKeywords.js / SCENE_TONE_MAP / _generateReason 文案 / 冲突矩阵）合并收敛
- [ ] 匹配算法从裸 `indexOf` 升级为词边界 + 别名/同义词映射（`面食→[面,粉,米线]`）
- [ ] 新增场景 = 只加一个声明对象，零算法改动
- [ ] 「面馆/面食」类覆盖回归通过

### ④ 共享 recommend 模块 + 组件（C）
- [ ] 新建 `utils/recommend.js`，暴露 `recommend(pois, scene, { mode })`
- [ ] `detectScene()` 双份复制消除
- [ ] `formatDistance/formatRating` 等工具双份收敛
- [ ] 自定义组件 `restaurant-card`、`coupon-float` 抽出，消除两页 WXML 重复块
- [ ] 两页退化为同一规格的两种 UI 外壳，行为不变

### ⑤ 共享 aiRecommend 模块（E）
- [ ] 新建 `utils/aiRecommend.js`，封装 POI+场景→调 GLM→收流式→返回 `{poi_id,reason}[]`
- [ ] 流式收集逻辑双份消除，提示词模板集中
- [ ] `parseRecommendJson.test.js` 从「抄函数」改为真正 `require`
- [ ] 两页 AI 调用走同一入口，行为不变

### 最终集成 review（父任务）
- [ ] 打分 → 场景 → AI 端到端一致（同一 POI 池 + 同一场景下，两页输出可解释、不回归）
- [ ] 全部子任务归档，无遗留漂移（grep 确认无残留的复制原语 / 散落场景表）

## Out of Scope

- 推荐算法本身的调参/换模型（本次只做「规格化」，不改业务逻辑权重数值）
- 新增业务场景（如「宵夜」之外的新场景）——这是 ③ 完成后验证扩展性的手段，不属于本任务交付
- CPS / 盲盒 E&E 算法的重写（已经是合格抽象，不在本次范围）
- POI 数据源（getPoi 云函数）改动

## Notes

- 本任务源于对老许《怎么做好产品设计》分享文档（13 页 PPT）的产品哲学映射诊断。
- 父任务不实现代码；每个子任务的详细 PRD 在各自 brainstorm 阶段定稿。
- 复杂子任务 ③④⑤ 需在 `task.py start` 前完成 `design.md`（+ 视情况 `implement.md`）。
- 子任务依赖序：①→②→③→④→⑤，串行推进。
