# 场景系统单一事实源与匹配算法升级

> 父任务：`06-24-rec-domain-refactor`（推荐域规格化重构）
> 前置依赖：② scoring-module（已归档；本任务的权重乘数仍由各自页面持有，但评分原语已共享）
> 后置约束：④ recommend-module 的统一入口将消费本任务的场景规格。

## Goal

把当前散落在 **5 处**的用餐场景定义，收敛为 `config/scenes.js` **单一事实源**（每个场景一份完整规格：匹配规则 + 语气色 + 文案 + 权重 profile + 冲突规则），并把匹配算法从裸 `indexOf` 升级为 **canonical + alias 别名映射**，根治 06-21 靠手工塞词打「面馆≠面食」补丁的根因。

对应老许方法论：slide5「场景广，不等于规格杂」、slide7「不能每多一个用户故事就多加一个」、slide10「通用语言提供领域化基础设施，而不是每个领域单独造 DSL」。新增/调整一个场景，未来 = 只改一个声明对象，零算法改动。

## User Value

- **根治同义归并**：「面馆」「拉面」「米线」「螺蛳粉」这类此前要手动塞词的高频品类，自动归入对应 canonical，不再漏判。
- **单一事实源**：新增场景或调整语气色/文案/冲突规则，只改 `config/scenes.js` 一处，不再 5 处同步（极易漏改）。
- 评分/推荐行为对用户可见结果**不回归**（同义归并只会让匹配更准，不会让原本命中的反而不命中）。

## Current Context（代码证据）

**5 处散落的场景定义（本次收敛目标）：**

| # | 位置 | 内容 | 语义 |
|---|------|------|------|
| 1 | `config/sceneKeywords.js:4-14` | `SCENE_KEYWORDS`（扁平关键词表）+ `SCENES`（6 场景列表） | 匹配 |
| 2 | `pages/index/index.js:10-17` | `SCENE_TONE_MAP`（场景→CSS 语气色 class） | UI chip 配色 |
| 3 | `pages/index/index.js:565-572` | `_generateReason` 内 `sceneTone` 文案表（场景→短句） | fallback 文案 |
| 4 | `utils/mysteryBox.js:160-164` | `conflicts` 冲突矩阵（仅覆盖 早餐/夜宵/下午茶 3 场景） | 盲盒严重不匹配提示 |
| 5 | 各处 `indexOf` 匹配（sceneMultiplier / timeAwareMultiplier / detectPoiScene） | 裸子串匹配算法 | 匹配（算法层） |

**匹配算法现状（待升级）：**
- 全部用 `keywords.some(k => haystack.indexOf(k) >= 0)`，无词边界、无同义归并。
- `sceneMultiplier`（index）：match=1.0 / no-match=**0.5**（硬砍半）
- `timeAwareMultiplier`（mysteryBox）：match=1.2 / no-match=**0.85**（软引导，06-21 调过）
- `detectPoiScene` / `isSceneMismatch`（mysteryBox）：用于盲盒严重不匹配提示。

**06-21 的教训（本次要根治的根因）：**
- 06-21 任务发现「面馆」(150m,4.6分) 综合权重反低于 800m「阿婆肠粉」，因「面馆」未命中午餐词表「面食」。
- 06-21 的修复**刻意不改算法**（PRD「Out of Scope: 不改匹配算法，控制改动面」），靠手动把「面馆/米线/麻辣烫」等塞进词表。
- 现在补上算法层，让同义归并自动化，06-21 的回归用例（「面馆」权重 > 「肠粉」）成为本任务的回归基线。

## Confirmed Design Decisions

1. **匹配算法 = canonical + alias 别名映射**（已确认采用，非词边界正则、非纯扁平表）：
   - 每个场景声明若干 **canonical 类目**，每个类目带 **alias 列表**。
     - 例：午餐 `{ '面食': ['面','面馆','拉面','刀削面','烩面','板面'], '粉食': ['粉','米粉','米线','酸辣粉','螺蛳粉','肠粉'], '快餐': ['快餐','简餐','便当','盖饭','盒饭','黄焖鸡','麻辣烫','砂锅','炒饭'] }`
   - 匹配函数 `matchesScene(scene, poi)`：把 POI 的 `name+type+typecode` 与该场景所有 canonical + alias 的**并集**做子串命中。命中任一即视为该场景匹配。
   - **保留子串匹配**（不引入词边界正则）：餐饮 POI 文本不存在「粉」误命中「粉笔」的现实风险，词边界正则收益极低却放大回归面与复杂度（避免过度工程）。

2. **`config/scenes.js` 单一事实源**，每个场景一份完整规格对象：
   ```
   {
     name,           // '午餐'
     toneClass,      // 'tone-spicy'  （原 SCENE_TONE_MAP）
     reasonTone,     // '中午对付一口' （原 _generateReason sceneTone）
     match: { canonical: [alias...] },   // 别名映射（原 SCENE_KEYWORDS 升级）
     weights: { d, q, longtail? },        // 权重 profile（首页/盲盒各自引用，详见 design.md）
     conflicts: [...]                     // 严重冲突场景（原 conflicts 矩阵）
   }
   ```
   导出 `SCENES`（场景声明数组）+ `matchesScene(sceneName, poi)` + 查询辅助。

3. **两套乘数语义保持各自页面持有**（不强行统一）：
   - 首页 `sceneMultiplier`（1.0/0.5 硬砍）与盲盒 `timeAwareMultiplier`（1.2/0.85 软引导）的**系数**不变，但内部匹配调用统一改为 `matchesScene`。
   - 乘数函数本身留在各自文件（首页/mysteryBox），不迁到 config——config 只放数据与声明，不放带业务系数的逻辑。

4. **`config/sceneKeywords.js` 的去留**：被 `config/scenes.js` 取代后删除，所有 `require('../config/sceneKeywords.js')` 改指向 `config/scenes.js`。`SCENE_KEYWORDS` 扁平表不再存在（其信息被 `match` 别名映射吸收并扩充）。

5. **冲突矩阵补全**：当前只覆盖 3 场景，`config/scenes.js` 为全部 6 场景声明 `conflicts`（如 早餐↔夜宵、下午茶/饮品↔早餐&夜宵、其余按常识补）。

6. **行为不回归**：同义归并只会扩大命中集（原本命中的仍命中），不会缩小。06-21 回归用例（「面馆」权重 > 「肠粉」）必须通过，且更强（无需靠塞词）。

## Requirements

### 新建 `config/scenes.js`
- 导出 `SCENES`（6 场景声明对象数组）与 `matchesScene(sceneName, poi)`、`getScene(name)`、`SCENE_NAMES`。
- 每场景含：`name / toneClass / reasonTone / match{canonical:[alias]} / weights / conflicts`。
- `match` 别名映射在 06-21 词表基础上扩充同义词（详见 design.md 的逐场景清单）。

### 匹配函数统一
- 首页 `sceneMultiplier`、盲盒 `timeAwareMultiplier / detectPoiScene`、`isSceneMismatch` 内部匹配全部改用 `matchesScene`。
- 各乘数**系数不变**（1.0/0.5、1.2/0.85）。

### 收敛散落定义
- 删除 `config/sceneKeywords.js`，改 require 指向 `config/scenes.js`。
- `pages/index/index.js`：删 `SCENE_TONE_MAP`（→ 用 scenes.toneClass）；`_generateReason` 的 `sceneTone` 表（→ 用 scenes.reasonTone）；`SCENE_OPTIONS` 由 scenes 派生。
- `utils/mysteryBox.js`：删 `conflicts` 矩阵（→ 用 scenes.conflicts）。

### detectScene / 时段检测
- `detectScene()`（index.js:90-97 ≡ mystery.js 同名）的时段→场景映射，本次**暂不迁入 config**（它是「按当前时间选场景」的逻辑，与「场景规格」正交），留待 ④ recommend-module 统一抽取。本任务仅确保它返回的场景名与 scenes.js 的 `name` 一致。

## Acceptance Criteria

### 结构
- [ ] 新建 `config/scenes.js`，单一事实源，含 6 场景完整规格
- [ ] 删除 `config/sceneKeywords.js`，无残留 require（grep 确认）
- [ ] `pages/index/index.js` 不再有 `SCENE_TONE_MAP` 与内联 sceneTone 表
- [ ] `utils/mysteryBox.js` 不再有本地 `conflicts` 矩阵
- [ ] 所有场景匹配走 `matchesScene`，无裸 `indexOf` 关键词匹配残留（乘数函数除外，它们调 matchesScene）

### 匹配算法（同义归并根治）
- [ ] 「面馆」「拉面」自动命中午餐（无需在词表里显式列）
- [ ] 「米线」「螺蛳粉」自动命中（午餐粉食 / 夜宵）
- [ ] 06-21 回归基线：午餐时段「特色小面馆」(150m,4.6) 综合权重 > 800m「阿婆肠粉」通过，且**不再依赖** 06-21 手工塞的词
- [ ] 新增一个同义品类 = 只在对应场景 `match` 加一个 alias，零算法改动（可演示）

### 行为（不回归）
- [ ] 首页 sceneMultiplier 系数不变（match 1.0 / no-match 0.5）
- [ ] 盲盒 timeAwareMultiplier 系数不变（match 1.2 / no-match 0.85）
- [ ] 盲盒严重不匹配提示（isSceneMismatch）行为不变，且覆盖全部 6 场景（不再只 3 个）
- [ ] 首页/盲盒打分在「原本就命中」的 POI 上 score 不变（命中集只扩不缩）
- [ ] `pages/index/parseRecommendJson.test.js` 仍 11 项全过
- [ ] 首页场景 chip 配色（toneClass）与 fallback 文案（reasonTone）与重构前一致

### 契约
- [ ] `mysteryBox.js` 仍正常 export `mysteryBoxRecommend` 等公开 API，行为不回归

## Out of Scope

- `detectScene()` 时段检测逻辑的迁移 → ④ recommend-module
- `topN/topNWithExplore`、`weightedRandomPick` 等选择逻辑 → ④
- 两套乘数系数的统一（1.0/0.5 vs 1.2/0.85）→ 本次只统一匹配，不统一系数
- AI 提示词层 → ⑤

## Open Questions

（匹配算法方案已确认采用 canonical+alias；其余无遗留）

## Notes

- **复杂任务**，需 `design.md`（逐场景 canonical/alias 清单、matchesScene 契约、迁移映射表、回归脚本设计）。
- 关键纪律：config 只放数据+声明，乘数系数留在页面；只统一匹配算法，不统一乘数语义。
- 回归手段：用 Node 脚本跑 06-21 基线用例 + 同义归并用例 + 「原本命中仍命中」用例（用完即删，不引入测试框架，沿用 06-21 做法）。
