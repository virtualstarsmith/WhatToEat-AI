# 扩大 POI 候选池：云函数翻页聚合支持密集商圈

## Goal

在 `getPoi` 云函数中引入高德「周边搜索」翻页聚合，把候选 POI 池从硬上限 **25 家（单页）** 提升到 **最多约 100 家（4 页）**，重点解决大城市商务办公区（CBD）等高密度场景下"附近餐厅远超 25 家，但盲盒/AI 推荐永远只能看到最近 25 家"的问题。让盲盒的"探索/惊喜"和 AI 推荐的候选质量都回到合理水位。

## Current Context

**Confirmed Facts（来自代码勘察）：**
- 微信小程序原生开发。位置与 POI 通过 `utils/locationHelper.js` + `app.globalData` 在 `pages/index`（AI 推荐）与 `pages/mystery`（盲盒）间共享。
- `cloudfunctions/getPoi/index.js` 调用高德 `/v3/place/around`：`types=050000`（餐饮服务）、`radius=2000`（2km，由 `locationHelper.js:74` 传入）、`offset=25`，**未传 `page` 参数，无翻页循环** → 一次最多返回 25 家（高德按距离排序的第一页）。
- 高德周边搜索响应含 `count`（总匹配数），支持 `page` 翻页，`offset` 单页上限 25。
- `utils/locationHelper.js` 有 `POI_CACHE_TTL = 5min` 缓存，同一坐标 + 5 分钟内复用 `globalData.pois`，不重复调用云函数。
- 两页消费方式：AI 页 `topN(scored, 7)` 取前 7 喂给 GLM；盲盒页把全部 `pois` 经 `qualifyFilter`（评分≥3.5 或 500m 内无评分）后参与 Epsilon-Greedy。
- 现状问题：CBD 内 2km 常有 100~200 家餐厅，但只取最近 25 家 → 盲盒池单薄、同质化；AI 候选范围偏窄。

## Requirements

**核心功能：**
- `getPoi` 云函数改为**自适应翻页聚合**：第一页拿到 `count` 后，按需追加翻页，聚合多页结果。
- **目标候选池上限：100 家（4 页 × 25）**（Confirmed - 推荐档）。
- **自适应**：`count ≤ 25` 时只拉 1 页，稀疏地区零额外成本；仅当 `count > 25` 才追加翻页，且不超过 4 页上限。
- 多页结果**按 `location + name` 去重**，避免边界处同一商家重复进入候选池（否则盲盒可能开出同一家两次）。
- 聚合后**按距离升序排序**返回，与现有"最近优先"语义一致。
- **优雅降级**：追加页失败（超时/网络）不影响已成功页面，返回已拿到的部分结果。

**约束：**
- 搜索半径 `radius` 保持 **2000（2km）不变**（Confirmed）。CBD 问题是"密度高"而非"范围小"，靠翻页而非扩半径解决，避免拉入远距离低分店稀释质量。
- `offset` 保持 25（高德单页上限）。
- 多页请求**并行**（`Promise.all`），降低整体延迟。
- 云函数超时上调至 **20s**（新增 `config.json`），覆盖 4 路并行最坏情况。
- 输出格式**向后兼容**：仍返回 `{ status, pois }`，`pois` 元素结构不变（`normalizePoi` 产物），下游 `locationHelper` / 两页面无需改动即可受益。

**不需要改动的部分（自动受益）：**
- `utils/locationHelper.js`：缓存逻辑、`fetchPois` 调用方式不变。
- `pages/index`：`topN(scored, 7)` 从更大池子选，质量自动提升；无需改 topN。
- `pages/mystery`：`mysteryBoxRecommend` 从更大池子过滤，盲盒多样性自动提升。

## Acceptance Criteria

### 功能验收
- [ ] `getPoi` 在 `count > 25` 时发起多次高德请求（带 `page` 参数），聚合返回 > 25 家。
- [ ] `count ≤ 25` 时仍只发起 1 次请求，行为与改造前一致（稀疏地区零额外开销）。
- [ ] 返回 POI 数量上限约 100 家（4 页），受 `count` 与 `MAX_PAGES` 双重约束。
- [ ] 跨页重复的同一商家（相同 `location + name`）只保留一条。
- [ ] 返回结果按 `distance` 升序排序。
- [ ] 返回结构仍是 `{ status: 'ok', pois: [...] }`，单条 POI 字段与现有一致（name/address/location/distance/typecode/type/rating/cost）。

### 鲁棒性验收
- [ ] 追加页（第 2~4 页）任一失败时，仍返回已成功的部分（status='ok'，不为空时）。
- [ ] 所有页都失败或第一页异常时，返回 `{ status: 'error', ... }`，行为与现状一致。
- [ ] 云函数在 4 路并行下整体耗时 < 20s（超时配置生效）。

### 下游兼容验收
- [ ] AI 推荐页正常工作：场景切换、换一批、推荐结果展示无回归。
- [ ] 盲盒页正常工作：开盒、去重、池耗尽提示无回归。
- [ ] `locationHelper` 5 分钟缓存仍生效：同坐标短时间多次调用不重复打云函数。
- [ ] CBD 场景实测：盲盒连开 ≥10 次不重复 / 池明显更丰富（人工抽测）。

### 性能/成本验收
- [ ] 非密集区（`count ≤ 25`）：API 调用数 = 1，与改造前一致。
- [ ] 密集区（`count` 很大）：API 调用数 ≤ 4，且有 5min 缓存兜底，单用户会话不反复触发。

## Out of Scope

- 动态/分时段调整 `radius` 或 `MAX_PAGES`（保持固定配置，后续可按监控再调）。
- AI 推荐页 `topN(7)` 调大（7 候选对 GLM 选 1~3 家已足够，暂不改）。
- 营业时间、人均消费等额外字段的获取（仍用高德返回的现有字段）。
- 引入新的数据源（仅高德）。
- 后端持久化/统计（纯云函数无状态改造）。

## Open Questions

（核心决策已确认：候选池上限 100 家 / 半径 2km 不变 / 自适应翻页 / 并行+去重。无遗留问题。）

## Notes

- 重点改 `cloudfunctions/getPoi/index.js`；新增 `cloudfunctions/getPoi/config.json`（超时）。
- 下游（`locationHelper`、两页面）预期零改动，自动受益——这是该方案的低风险所在。
- 灰度/回滚：云函数改动，回滚 = 重新部署旧版 `index.js`；无数据库、无前端Breaking。
