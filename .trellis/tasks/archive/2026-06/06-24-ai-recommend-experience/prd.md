# AI甄选与盲盒推荐体验提质

## Goal

围绕"AI 甄选"的四个核心价值（理由、免责、被理解、惊喜），提升首页 AI 推荐（`pages/index`）与盲盒推荐（`pages/mystery`）两端的"会说话"质感，并修复推荐卡片店铺类型全部显示为"餐饮"的体验缺陷。本任务是 AI 甄选体验的整体提质，不涉及推荐算法（评分公式 / Epsilon-Greedy 等）本身。

## Background（问题溯源）

复盘 AI 甄选功能后，对照"理由 / 免责 / 被理解 / 惊喜"四个价值维度，发现现有实现存在五处体验缺口：

1. **AI prompt 缺语境**：`callAIRecommend` 的 system/user message 只传 `scene + candidates`，AI 不知道当前时间 / 星期，无法"识相"地调整语气；system prompt 把 AI 定位成"推荐助手"，生成的 reason 容易退化成"评分X分距离Y米"的说明书复述，与本地 fallback 模板拉不开差距——AI 的核心护城河（会说话）没被激活。
2. **fallback 暴露降级**：兜底 banner 文案"智能推荐暂不可用，已为你按距离和评分筛选"直接戳破"AI 推荐"的连续感；`_generateReason` 是纯条件模板（"评分4.6分距离200米非常值得尝试"），与 AI reason 风格断层。而 AI 每日有 `dailyRefreshLimit=20` 上限，fallback 高频触发，核心卖点会在 20 次后消失。
3. **换一批重复撞车**：`excludeIds` 上限仅 6，候选池 `topNWithExplore(7, 2)` 只有 7 个，用户连续点"换一批"，前几轮推过的店在第 4 次会重新出现，破坏"惊喜感"。
4. **POI type 全显示"餐饮"**：高德返回的多级分类串（如`餐饮服务;餐饮相关场所;中餐厅;中式快餐`），经 `normalizePoiType` 的 `split(';')[0]` 只取首段并映射成大类——所有店首段都是"餐饮服务"→ 一律显示"餐饮"，把"中式快餐""茶餐厅""面馆"等有用细分全丢了。
5. **盲盒理由与惊喜感张力不匹配**：盲盒页 `generateMysteryReason` 是纯本地模板（7 条随机选），但开盒有 2s 动画 + 震动悬念，用户满怀期待收到一条与首页 fallback 一样的模板话，惊喜载体上 AI 完全缺席。

## Decisions（已与用户确认）

| 决策点 | 选择 | 说明 |
|--------|------|------|
| AI 理由生成 | 增强首页 prompt + 盲盒探索档接入 AI | 首页全量接 AI；盲盒仅探索档（30%）接 AI，成本花在刀刃上 |
| 语境信号 | 仅加 time + weekday | 不引入天气 API（有鉴权/成本/降级链路问题），归第四梯队 |
| fallback 文案 | 软化提示 + reason 口语化 | `source` 信号保留用于埋点，用户侧不暴露失败 |
| exclude 上限 | 6 → 15 | ≈ 两轮"换一批"，远小于 POI 池规模，不榨干候选 |
| 候选动态扩 | 7 → 10（exclude 多时） | 避免候选池被 exclude 填满反复撞车 |
| type 细分 | 改进 `normalizePoiType` 取末段 | 共享工具函数，首页+盲盒自动受益，一处改动 |
| 盲盒 AI 时序 | 与开盒动画并行 | AI 请求与 2s 动画并发，用户零额外等待；失败回退模板 |

**不改动的部分**（明确排除）：
- 评分公式（首页 `0.5×距离+0.5×质量`、盲盒 `0.4/0.4/0.2`）、Epsilon-Greedy、`midBandPick` 等算法逻辑不动。
- `SCENE_KEYWORDS` 关键词表不动。
- 盲盒利用档（高分店）仍用本地模板，不调 AI。
- 不引入天气 API、不做"换一批负反馈对话"（第四梯队）。

## Requirements

### R1 · 首页 AI prompt 上下文增强（`pages/index/index.js`）

- `callAIRecommend` 的 user message 新增 `time`（如 `08:30`）与 `weekday`（如`周一`）字段。
- system prompt 从"推荐助手"升级为"最懂吃的朋友"，明确禁止"评分X分距离Y米"的说明书式复述，要求抓当下语境（午餐强调近和快、夜宵强调解馋、周末强调犒劳），突出此刻最值得的一点。
- 新增 `padHour` / `padMinute` 辅助函数补零，保证时间格式稳定。

### R2 · Fallback 体验软化（`pages/index/index.js` + `pages/index/index.wxml`）

- `_generateReason` 重写为"场景语气短句 + 店况补足"：早餐"早饭得趁热"、夜宵"夜深解个馋"等场景语气，再按近/高分/普通配口语化理由，读起来与 AI reason 几乎无差。
- banner 文案改为中性（"为你又挑了几家，看看哪家合口味"），不喊"暂不可用"。`source === 'fallback'` 信号保留（用于埋点）。

### R3 · Exclude 扩容 + 候选动态扩（`pages/index/index.js`）

- `onRefresh` 中 `excludeIds` 上限 `6 → 15`。
- `callRecommend` 中候选数根据 exclude 数量动态：exclude ≤6 时 7 个、>6 时扩到 10 个。

### R4 · POI type 细分修复（`utils/util.js`）

- 新增 `POI_TYPE_NOISE_SEGMENTS` 集合，标记"餐饮服务""餐饮相关场所"等分类废话段。
- `normalizePoiType` 从"取首段大类映射"改为"**从末段往前找第一个非废话段**"（即最具体业态），拿不到细分再回退首段大类映射。
- `POI_TYPE_MAP` 保留作为最终兜底。首页卡片、盲盒卡片、盲盒理由三处调用方自动受益。

### R5 · 盲盒探索档接入 AI 惊喜理由（`utils/mysteryBox.js` + `pages/mystery/mystery.js`）

- `mysteryBoxRecommend` 返回签名扩展为 `{poi_id, poi, fromExplore}`，探索档 `true` / 利用档 `false`。
- 新增 `buildMysteryPrompt`（盲盒专属 prompt，引导"既然开出来了就去呗"的惊喜语气）与 `callMysteryAIReason`（调 AI 取一句话理由，失败/超时 resolve null）。
- `onOpenMysteryBox` 在探索档时**与 2s 开盒动画并行**发起 AI 请求；`_revealMysteryBox` 改为 async，先取模板保底，AI 已就绪则覆盖。
- 场景严重不匹配（如夜宵开出早餐店）一律用模板硬提示，不调 AI。
- 利用档不调 AI，仍用本地模板（成本控制：仅 30% 探索档调 AI）。

## Acceptance Criteria

- [x] **AC1**：首页 AI 推荐 prompt 携带 time/weekday 上下文，system prompt 要求自然口语化理由，禁止说明书复述。
- [x] **AC2**：首页 fallback 的 `_generateReason` 输出场景化口语文案；banner 不再出现"暂不可用"字样。
- [x] **AC3**：连续"换一批"，excludeIds 上限为 15；exclude >6 时候选数扩到 10。
- [x] **AC4**：`normalizePoiType('餐饮服务;餐饮相关场所;中餐厅;中式快餐')` 返回"中式快餐"而非"餐饮"；全废话段回退大类映射。
- [x] **AC5**：`mysteryBoxRecommend` 返回结果含 `fromExplore` 布尔字段，200 次模拟探索占比 ≈30%（实测 30.5%）。
- [x] **AC6**：盲盒探索档开盒时发起 AI 理由请求，与开盒动画并行；AI 失败/超时不阻塞揭晓，回退本地模板。
- [x] **AC7**：场景严重不匹配时不调 AI（用模板硬提示）。
- [x] **AC8**：`node --check` 语法通过，`parseRecommendJson.test.js` 11 项全过。

## Notes

- 本任务为 PRD-only（代码已在本次会话实现完毕，PRD 为事后追溯记录）。
- 改动范围：`pages/index/index.js`、`pages/index/index.wxml`、`utils/util.js`、`utils/mysteryBox.js`、`pages/mystery/mystery.js`。无新增依赖，无跨文件契约破坏。
- `normalizePoiType` 修复在前端实时计算，POI 缓存（5min TTL）内一刷新即生效，无需重新部署云函数。
- 未做的后续项（归第四梯队）：天气感知场景检测、换一批负反馈对话、盲盒利用档是否也接 AI。
