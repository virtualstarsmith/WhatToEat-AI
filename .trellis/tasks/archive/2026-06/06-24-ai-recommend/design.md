# 抽取 utils/aiRecommend.js 统一 AI 调用层 — 技术设计

> 任务：`06-24-ai-recommend`。配合 `prd.md`。

## 1. 架构与边界

```
utils/aiRecommend.js   ← 纯函数 parseRecommendJson/tolererantParseRecommendations
                         + streamAiText(封装 wx.cloud AI 流式) + callAiRecommend(promptBuilder 注入)
   ↑ import
pages/index/index.js    （callAIRecommend 改调 callAiRecommend；删本地 parseRecommendJson）
pages/mystery/mystery.js（callMysteryAIReason 改调 callAiRecommend/streamAiText）
pages/index/parseRecommendJson.test.js  （改 require，删抄写）
```

## 2. `utils/aiRecommend.js` 契约

### 2.1 纯解析函数（从 index.js:125-195 **逐行迁移**，不改逻辑）

```js
function parseRecommendJson(raw) { /* 4 层容错：JSON.parse → 围栏 → {...} 子串 → tolerantParseRecommendations */ }
function tolerantParseRecommendations(text) { /* 字段名扫描：poi_id/reason 顺序配对 */ }
```
- 4 层容错与 tokenRe 正则**原样保留**（real-world bug 修复的核心，零改动）。

### 2.2 `streamAiText(messages, opts)` — 流式收集（合并 index/mystery 双份）

```js
// 返回完整 fullContent 字符串。封装 wx.cloud.extend.AI.createModel + streamText，
// 合并 index.js:365-431 与 mystery.js:83-119 的双路径累积逻辑（二者逐段近似）。
async function streamAiText(messages, opts) {
  const { model = 'hy3-preview', response_format = { type: 'json_object' }, maxEvents = 100 } = opts || {};
  const aiModel = wx.cloud.extend.AI.createModel('cloudbase');
  const res = await aiModel.streamText({ data: { model, messages, stream: true, response_format } });

  let fullContent = '';
  let eventCount = 0;
  const collectChunk = (chunk) => { if (chunk && typeof chunk === 'string') fullContent += chunk; };

  // 路径1：textStream（纯文本增量，最稳）
  if (res && res.textStream) {
    try {
      for await (const chunk of res.textStream) {
        if (++eventCount > maxEvents) break;
        collectChunk(chunk);
      }
    } catch (e) { /* 回退 eventStream */ }
  }
  // 路径2：eventStream（手动提取 content）—— textStream 未累积到内容时回退
  if (!fullContent && res && res.eventStream) {
    eventCount = 0;
    for await (let event of res.eventStream) {
      if (++eventCount > maxEvents) break;
      if (event == null) continue;
      if (event.data === '[DONE]') break;
      let data = event.data;
      if (typeof data === 'string') {
        if (data === '[DONE]' || !data.trim()) continue;
        try { data = JSON.parse(data); } catch (e) { continue; }
      }
      if (data == null || typeof data !== 'object') continue;
      const content = data?.choices?.[0]?.delta?.content ||
                      data?.choices?.[0]?.message?.content ||
                      data?.content;
      collectChunk(content);
    }
  }
  return fullContent;
}
```
**行为对齐**：maxEvents=100、textStream→eventStream 回退、`[DONE]` 处理、content 三级取值（delta/message/裸 content）全部保留。index 当前在 textStream 路径也限了 maxEvents（:392-393），合并后统一在两路径限流。

### 2.3 `callAiRecommend(opts)` — promptBuilder 注入

```js
// opts.messages: 已构造好的 messages（由调用方 promptBuilder 产出）
// opts.onParsed: 解析后回调（首页做 candidateMap 校验+取 3 条；盲盒取 reason）
// 返回 parseRecommendJson 结果（首页）或 reason 字符串（盲盒，由 onParsed 决定）
async function callAiRecommend(opts) {
  const { messages, maxEvents } = opts || {};
  const fullContent = await streamAiText(messages, { maxEvents });
  if (!fullContent || !fullContent.trim()) return null;
  return parseRecommendJson(fullContent);
}
```
- **promptBuilder 注入**：messages 由调用方构造（首页 system prompt index.js:335-345；盲盒 `buildMysteryPrompt` mystery.js:42-78）。提示词文案不改，只搬迁到调用点（或留各自页面传入）。
- **首页**用 `callAiRecommend` 拿 `{recommendations}`，candidateMap 校验留在 index.js（业务 join，:468-478）。
- **盲盒**：mystery 的 reason 解析（cleaned/JSON.parse/围栏/取 reason）与 `parseRecommendJson` 的 4 层容错**逻辑一致但取字段不同**（mystery 取 `reason`，index 取 `recommendations[]`）。为避免改盲盒行为，盲盒**直接用 streamAiText + 自己的 reason 提取**（保留 mystery.js:124-135 的 reason 取值逻辑），不强制套 parseRecommendJson。

## 3. 迁移映射

| 原位置 | 原 | 迁移 |
|--------|----|------|
| index.js:125-195 | parseRecommendJson/tolerantParseRecommendations | → aiRecommend.js（逐行迁），index import |
| index.js:335-445 | callAIRecommend（messages+streamText+累积+parse） | messages 留页面，stream+parse 改调 callAiRecommend |
| mystery.js:80-140 | callMysteryAIReason（streamText+累积+reason 解析） | stream 改调 streamAiText，reason 解析留 mystery |
| test.js:10-50 | 抄写的 parseRecommendJson/tolerantParseRecommendations | 删，改 require('../../utils/aiRecommend.js') |

## 4. 测试 require 化（关键收益）

`parseRecommendJson.test.js`：
- 删除本地抄写的 `parseRecommendJson`/`tolerantParseRecommendations`（test.js:10-50 区域）。
- 顶部加 `const { parseRecommendJson } = require('../../utils/aiRecommend.js');`
- 11 项断言**完全不变**（输入字符串 + 期望对象）。
- header 注释更新：从「避免引入运行时依赖，复制实现」改为「require 生产模块，与实现同源」。
- 验证：`node pages/index/parseRecommendJson.test.js` 仍 11 passed。

## 5. 与 ③④ 的合并边界

| 文件 | ③ 区域 | ④ 区域 | ⑤ 区域（本任务）|
|------|--------|--------|----------------|
| index.js | 场景匹配/tone | detectScene/format/卡片红包 | **callAIRecommend(335-445) + parseRecommendJson(125-195)** |
| mystery.js | SCENES import | detectScene/format/卡片红包 | **callMysteryAIReason(80-140)** |
| 新文件 | config/scenes.js | utils/recommend.js + 2 组件 | **utils/aiRecommend.js** |

5 在 index.js 的区域（125-195、335-445）与 ③④ 不重叠；mystery.js 仅 80-140。合并时 git 三方合并通常自动处理；callAIRecommend 函数体替换可能需人工核对 import 行。

## 6. 验证

- `node -c utils/aiRecommend.js` + 改动页面语法校验。
- `node pages/index/parseRecommendJson.test.js` 11 项全过（**这是 ⑤ 最硬的回归基线**）。
- 行为核对：首页 AI 推荐流式+容错+candidateMap 校验；盲盒 reason 提取；AI 失败回退。
- grep 确认 index.js/mystery.js 无本地 `parseRecommendJson`/流式累积残留。

## 7. 风险与回滚

- **风险**：streamAiText 合并两份累积逻辑时漏掉某分支。缓解：逐行对照 index.js:365-431 与 mystery.js:83-119，二者取**并集**（index 有 maxEvents 限流、mystery 有裸 content 兜底，合并后全保留）。
- **风险**：盲盒 reason 解析若误套 parseRecommendJson 会改变取字段行为 → 设计上盲盒保留自己的 reason 提取，只用 streamAiText，规避。
- **回滚**：单 commit revert。
