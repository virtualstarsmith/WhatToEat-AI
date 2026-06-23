# 抽取 utils/aiRecommend.js 统一 AI 调用层

> 父任务：`06-24-rec-domain-refactor`
> 前置依赖：逻辑独立。本任务改 `index.js:callAIRecommend`（:335-445）与 `mystery.js` 内 AI 流式调用（:80-140）+ `parseRecommendJson`（:125-206）。与 ③④ 在**不同函数区域**，worktree 并行、合并时按区域解冲突。

## Goal

把首页与盲盒页**重复的 AI 调用与流式收集逻辑**收敛为 `utils/aiRecommend.js`，集中提示词模板，并让 `parseRecommendJson` 成为可 `require` 的模块函数（而非被测试文件整份抄写）。

对应老许方法论 slide11「快的是认知迭代和做事方法论，不是产品规格本身」——让 AI 层的迭代（提示词、模型、容错）发生在方法论层，而产品规格（输入 POI+场景 → 输出 `{poi_id,reason}[]`）保持稳定。slide3「大模型不是产品，稳定可交付的 AI 服务才更接近产品」。

## User Value

- 消除流式收集双份复制（漂移：首页修了容错、盲盒漏改）。
- 提示词集中，调优一处生效两处。
- 测试从「抄函数」改为真正 `require`，与生产代码同源（消除测试与实现分叉）。

## Current Context（代码证据）

**AI 流式调用双份：**
- `index.js:335-445` `callAIRecommend`：构造 messages → `wx.cloud.extend.AI.createModel('cloudbase')` → `model.streamText({model:'hy3-preview',stream:true,response_format:{type:'json_object'}})` → textStream 优先/eventStream 回退累积 → `parseRecommendJson`。
- `mystery.js:42-140` `buildMysteryPrompt` + 流式收集（同样的 textStream/eventStream 双路径累积逻辑）。
- 两处的 maxEvents=100、collectChunk、textStream→eventStream 回退**逐段近似**。

**parseRecommendJson 被测试抄写：**
- `index.js:125-206` 定义 `parseRecommendJson` + `tolerantParseRecommendations`（4 层容错）。
- `pages/index/parseRecommendJson.test.js:8-9` header 注释明写「避免引入 wx/cloud 运行时依赖，直接复制实现」——因 index.js 是 `Page({...})` 注册，函数无法被 require。
- 后果：测试与实现分叉，改实现必须同步改测试（极易漏）。

**real-world bug（容错存在的理由）：**
- hy3-preview 流式丢字符，`"poi_id":"4"` 退化为 `"po_id"44"`，4 层容错（JSON.parse→围栏→大括号→字段扫描）挽救。见 test.js:134-154。

## Confirmed Design Decisions

1. **`utils/aiRecommend.js`** 导出：
   - `parseRecommendJson(raw)` + `tolerantParseRecommendations(text)`（从 index.js 迁出，**纯函数、无 wx 依赖**，可被 node require 测试）。
   - `streamAiText(messages, opts)`：封装 `createModel + streamText + textStream/eventStream 累积`，返回完整 `fullContent`。opts 含 model/response_format/maxEvents。
   - `callAiRecommend(opts)`：首页用「推荐候选」prompt，盲盒用「惊喜理由」prompt（promptBuilder 注入）。
2. **提示词集中（promptBuilder 注入）**：首页 system prompt（:335-345）与盲盒 `buildMysteryPrompt`（mystery.js:42+）的 messages 构造由调用方以 promptBuilder 回调注入 aiRecommend——保持灵活，提示词文案不改（纯搬迁）。
3. **index.js / mystery.js 改造**：`callAIRecommend` 改为调用 `callAiRecommend(...)`；删除本地流式累积与 parseRecommendJson 定义。
4. **测试改造**：`parseRecommendJson.test.js` 删除抄写的实现，改 `require('../../utils/aiRecommend.js')` 的 `parseRecommendJson`。断言不变（11 项）。
5. **行为不回归**：4 层容错、textStream→eventStream 回退、maxEvents=100、response_format 全保留。

## Requirements

### 新建 `utils/aiRecommend.js`
- 导出 `parseRecommendJson`、`tolerantParseRecommendations`、`streamAiText(messages, opts)`、`callAiRecommend(opts)`。
- 无 `wx`/`cloud` 顶层依赖（`streamAiText` 内部用 `wx.cloud.extend.AI`，但函数体在调用时才求值，模块可被 node require 测试 parseRecommendJson）。

### `pages/index/index.js`
- 删除 `parseRecommendJson`/`tolerantParseRecommendations`（:125-206），从 aiRecommend 引入。
- `callAIRecommend`（:335-445）改为调 `callAiRecommend`，传入 promptBuilder（首页推荐 system prompt）。
- 保留 `candidateMap` 校验逻辑（:468-478）在页面（业务 join）。

### `pages/mystery/mystery.js`
- AI 流式调用（:80-140）改为调 `callAiRecommend`/`streamAiText`，promptBuilder 用 `buildMysteryPrompt`。

### `pages/index/parseRecommendJson.test.js`
- 删除抄写的 `parseRecommendJson`/`tolerantParseRecommendations`，改 `require('../../utils/aiRecommend.js')`。
- 断言不变。

## Acceptance Criteria

### 结构
- [ ] 新建 `utils/aiRecommend.js`，导出 parseRecommendJson/tolerantParseRecommendations/streamAiText/callAiRecommend
- [ ] `index.js`/`mystery.js` 不再有本地 parseRecommendJson / 流式累积逻辑
- [ ] `parseRecommendJson.test.js` 用 require 而非抄写（header 注释更新）

### 行为（不回归）
- [ ] `parseRecommendJson.test.js` 11 项全过（含 real-world corrupt sample 容错）
- [ ] 首页 AI 推荐：流式收集、4 层容错、candidateMap 校验、3 条结果，行为不变
- [ ] 盲盒 AI 惊喜理由：流式收集、惊喜语气 prompt，行为不变
- [ ] AI 失败回退（首页 _useFallbackRecommend、盲盒不调 AI）不受影响

### 跨任务对齐
- [ ] 改动集中在 `callAIRecommend`/mystery AI 区域，不触碰 ③ 的场景匹配区、④ 的 detectScene/format 区

## Out of Scope

- 提示词内容本身的调优（本任务只搬迁集中，不改文案）
- 模型切换/hy3-preview 替换
- 候选选择逻辑（scoreCandidates/topN）→ 不动

## Open Questions

（无）

## Notes

- 复杂任务，需 `design.md`（aiRecommend 函数签名、promptBuilder 注入契约、streamAiText 回退逻辑、测试 require 化迁移）。
- 关键纪律：4 层容错与回退逻辑**逐行保留**，纯搬迁，不改容错行为。
