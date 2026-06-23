# 修复 poi_id 稳定性

> 父任务：`06-24-rec-domain-refactor`（推荐域规格化重构）
> 前置依赖：无（系列重构的第一个子任务）
> 后置约束：完成后，poi_id 稳定契约被后续 ②③④⑤ 全部沿用。

## Goal

把首页（AI 甄选）`pages/index/index.js` 当前用**数组下标** `String(idx)` 当 poi_id 的做法，改为**稳定唯一标识**，与盲盒页 `utils/mysteryBox.js:makePoiId` 语义统一。落地项目自家 spec（`06-14 design.md:202`「poi_id 必须稳定唯一标识，禁止用数组下标」），修复「换一批」去重在 POI 池顺序变化后失效/误删的潜在 bug。

## User Value

- 「换一批」时，已推荐过的店铺在 POI 池重新拉取/翻页/顺序变化后仍能被正确排除，不会重复推荐同一家，也不会误删新店。
- 首页与盲盒的 poi_id 语义一致，为后续 ②③④⑤ 子任务的共享域模块扫清契约障碍。

## Current Context（代码证据）

**首页用数组下标（违反 spec）：**
- `pages/index/index.js:52` —— `scoreCandidates` 内 `const poiId = String(idx)`，poi_id = 当前 POI 在传入数组中的下标。
- poi_id 在首页 3 处被消费：
  1. `index.js:457` `candidateMap = new Map(candidates.map(c => [c.poi_id, c]))` —— AI 输出按此 join
  2. `index.js:469,472` `candidateMap.has(String(r.poi_id))` / `candidateMap.get(...)` —— 校验 AI 返回的 poi_id
  3. `index.js:526` `currentRecs = recommendations.map(r => r.poi_id)` —— 构建下一轮 `excludeIds`

**盲盒已用稳定键（正确范式）：**
- `utils/mysteryBox.js:67-69` `makePoiId(poi)` = `${poi.location || ''}|${poi.name || ''}`，注释明确「池子顺序变化后同一店铺仍为同一 id」。
- `mysteryBox.js:109-114` 会话去重 `openedSet` 依赖此稳定键。

**数据源（getPoi）目前丢弃高德 id：**
- `cloudfunctions/getPoi/index.js:51-65` `normalizePoi` 返回 `{name,address,location,distance,typecode,type,rating,cost}` —— **没有透传高德 `poi.id` 字段**。
- `getPoi/index.js:107-114` 云函数自身的跨页去重已用 `location|name` 复合键。
- 高德 `around` 接口返回的每个 poi 对象**带 `id` 字段**（高德 POI 全局唯一 id），normalizePoi 当前未保留。

**excludeIds 不跨会话持久化（无迁移负担）：**
- `index.js:541` 只持久化 `dailyRefreshCount`；`excludeIds` 在页面 data 里，页面重载（onLoad）重置为 `[]`。所以不存在「旧下标 id 残留在 storage」的迁移问题。

## Confirmed Design Decisions

1. **稳定键策略：高德 `id` 优先，缺失兜底 `location|name`**（用户已确认）。
   - 首选高德 poi_id（全局唯一、最权威）。
   - 拿不到 id 时回退 `location|name`（与盲盒 `makePoiId`、getPoi 去重键一致）。

2. **getPoi 透传 `id` → 客户端兜底**：
   - `normalizePoi` 增加 `poi_id: poi.id || ''` 字段（getPoi 返回结构新增一项）。
   - 客户端新增统一 `makePoiId(poi)`：`poi.poi_id ? String(poi.poi_id) : \`${poi.location||''}|${poi.name||''}\``。

3. **`makePoiId` 放置位置**：本任务作为系列地基，先放在 `utils/util.js`（与 `normalizePoiType` 同级，已是 POI 相关纯函数集合），导出 `makePoiId`。后续 ② 抽 `scoring.js` 时若需要可再迁移；本任务不过度设计。

4. **盲盒 `makePoiId` 同步收口**：盲盒 `utils/mysteryBox.js:67-69` 的本地 `makePoiId` 改为 `require` util 版，消除两份实现，语义统一为「id 优先、location|name 兜底」。这是本任务顺带完成的「契约统一」，改动小且安全。

## Requirements

### `cloudfunctions/getPoi/index.js`
- `normalizePoi` 返回对象新增 `poi_id` 字段，取高德 `poi.id`（缺失时为空串）。

### `utils/util.js`
- 新增并导出 `makePoiId(poi)`：优先 `String(poi.poi_id)`，为空则回退 `\`${poi.location||''}|${poi.name||''}\``。

### `pages/index/index.js`
- `scoreCandidates`（`:48-58`）删除 `const poiId = String(idx)`，改用 `makePoiId(poi)`（从 util 引入）。
- 下游 `candidateMap`、AI 校验（`:469,472`）、excludeIds 构建（`:526`）无需改动——它们已统一用 `String(...)` 处理 poi_id，poi_id 本身变稳定后自动生效。
- `excludeSet` 构建（`:46`）保持 `String(id)` 归一。

### `utils/mysteryBox.js`
- 删除本地 `makePoiId`（`:67-69`），改为从 `utils/util.js` 引入。其余逻辑不变。
- 注意：盲盒此前用纯 `location|name`，现在变「id 优先」——因为 getPoi 现在会带回 `poi_id`，盲盒拿到的 poi 对象也会带 `poi_id`，所以盲盒的 poi_id 也会自动升级为高德 id（当存在时），`location|name` 仅在 getPoi 没回 id 时兜底。需确认盲盒会话内同一店铺 id 不抖动（同一份 pois 数组内 poi_id 稳定即可，跨会话重置 openedIds，无影响）。

## Acceptance Criteria

### 结构
- [ ] `getPoi/index.js` `normalizePoi` 返回对象含 `poi_id`（取高德 id，缺失为空串）
- [ ] `utils/util.js` 导出 `makePoiId(poi)`，实现「poi_id 优先 / location|name 兜底」
- [ ] `pages/index/index.js` 不再出现 `String(idx)` 作 poi_id
- [ ] `utils/mysteryBox.js` 删除本地 `makePoiId`，统一引入 util 版

### 行为（不回归）
- [ ] 首页「换一批」：POI 池顺序变化（如重新 loadPois、翻页补齐）后，已推荐过的店铺仍被正确排除（不重复）
- [ ] 首页 AI 候选 join：AI 返回的 poi_id 仍能命中 candidateMap（因为同一份 pois 内 poi_id 稳定）
- [ ] 盲盒会话去重：同一会话内开过的店铺不重复开出
- [ ] 首页/盲盒 poi_id 语义统一（grep 确认无 `String(idx)`、无本地 `makePoiId` 残留）
- [ ] 现有 `pages/index/parseRecommendJson.test.js` 仍通过（本次不动解析逻辑）

### 契约
- [ ] 符合 `06-14 design.md:202`「poi_id 必须稳定唯一标识，禁止用数组下标」

## Out of Scope

- 评分原语三份复制的收敛（→ 子任务 ②）
- 场景系统单一事实源（→ 子任务 ③）
- AI 调用层抽离（→ 子任务 ⑤）
- getPoi 返回结构其他字段调整（仅新增 poi_id，不动现有字段）

## Open Questions

（已全部解决，无遗留问题）

## Notes

- 轻量任务，PRD-only 即可，无需 design.md / implement.md。
- 改动横跨云函数 + 两个页面 + util，但每处都是小而明确的替换，回归风险低（poi_id 由下标换稳定键，是纯加强，不改变排序/打分/文案语义）。
- 完成后 `task.py start` → 实现 → check → 提交 → 归档，再进入子任务 ②。
