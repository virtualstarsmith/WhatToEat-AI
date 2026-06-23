// 统一 AI 调用层：集中 parseRecommendJson（4 层容错）+ streamAiText（流式收集）
// + callAiRecommend（流式收集 + 解析）。
// 解析函数为纯函数、无 wx/cloud 顶层依赖，可被 node 直接 require 测试（见
// pages/index/parseRecommendJson.test.js）。streamAiText 在函数体内才求值
// wx.cloud.extend.AI，模块本身 require 时不触发运行时。
// 见 06-24-ai-recommend。

// 解析 AI 推荐返回的 JSON。
// 模型即便声明 response_format=json_object，仍可能：在 JSON 外带 markdown 围栏
// （```json ... ```）、自然语言开场白、或残留的流式协议片段。
// 这里依次尝试：原文 → 去零宽 → 提取首个 {...} 平衡子串，任何一步成功即返回。
// 注意：绝不用宽泛正则删除空格/标点，会破坏 reason 中的合法中文文本。
function parseRecommendJson(raw) {
  const cleaned = (raw || '').replace(/[\u200b-\u200d\ufeff]/g, '').trim();

  // 1) 直接解析（最常见路径）
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 继续尝试兜底
  }

  // 2) 剥离 markdown 代码围栏 ```json ... ``` 或 ``` ... ```
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (e) {
      // 继续尝试兜底
    }
  }

  // 3) 从首个 { 到配对的 } 截取平衡子串（处理模型在 JSON 前后塞废话的情况）
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (e) {
      // 继续尝试兜底
    }
  }

  // 4) 容错提取：hy3-preview 流式输出偶尔会丢字符（实测 "poi_id" 退化为 "po_id"、
  //    值的 :"/引号缺失等），导致整体 JSON 不可解析。此时改按字段名扫描——
  //    字段名 "poi_id"/"reason" 本身稳定出现——逐项顺序配对，跳过损坏的条目，
  //    挽救可用的推荐。消费侧本就会用 poi_id 校验 candidateMap，坏条目天然被滤掉。
  const recs = tolerantParseRecommendations(cleaned);
  if (recs.length > 0) {
    return { recommendations: recs };
  }

  throw new Error('AI response is not valid JSON');
}

// 按字段名从（可能损坏的）AI 文本中容错提取推荐项。
// 单次扫描，遇到 poi_id 后找下一个 reason 配对，保证对齐。
// poi_id 值容忍缺引号/缺冒号；reason 值按标准 JSON 字符串解析（容忍转义）。
function tolerantParseRecommendations(text) {
  if (!text) return [];
  const recs = [];
  // 同时匹配 poi_id 或 reason 两种字段，按出现顺序处理
  // - poi_id 分支：第 1 组为值（容忍缺引号/缺冒号的损坏形态）
  // - reason 分支：第 2 组为值（标准字符串，容忍 \" 转义）
  const tokenRe = /"?poi_id"?\s*:?\s*"?([^",:}\s\\]+)"?|"?reason"?\s*:?\s*"((?:[^"\\]|\\.)*)"/gi;
  let pendingId = null;
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    if (m[1] !== undefined) {
      pendingId = m[1];
    } else if (m[2] !== undefined && pendingId !== null) {
      recs.push({ poi_id: pendingId, reason: m[2] });
      pendingId = null;
    }
  }
  return recs;
}

// 封装 wx.cloud.extend.AI.createModel + streamText，返回完整 fullContent 字符串。
// 合并 index.js 与 mystery.js 的双路径流式累积逻辑（二者逐段近似），取并集：
// - maxEvents=100 限流（两路径统一）
// - textStream 优先（纯文本增量，最稳）→ 失败/为空回退 eventStream
// - [DONE] 处理、content 三级取值（delta / message / 裸 content）全部保留
async function streamAiText(messages, opts) {
  const { model = 'hy3-preview', response_format = { type: 'json_object' }, maxEvents = 100 } = opts || {};
  const aiModel = wx.cloud.extend.AI.createModel('cloudbase');
  const res = await aiModel.streamText({
    data: { model, messages, stream: true, response_format }
  });

  let fullContent = '';
  let eventCount = 0;

  const collectChunk = (chunk) => {
    if (chunk && typeof chunk === 'string') {
      fullContent += chunk;
    }
  };

  // 路径1：textStream（纯文本增量，最稳，无需关心 chunk 内部结构）
  if (res && res.textStream) {
    try {
      for await (const chunk of res.textStream) {
        eventCount++;
        if (eventCount > maxEvents) break;
        collectChunk(chunk);
      }
    } catch (streamErr) {
      // textStream 不可用时回退到 eventStream 解析
    }
  }

  // 路径2：textStream 未累积到内容时，回退遍历 eventStream 手动提取 content
  if (!fullContent && res && res.eventStream) {
    eventCount = 0;
    for await (let event of res.eventStream) {
      eventCount++;
      if (eventCount > maxEvents) break;
      if (event == null) continue;
      if (event.data === '[DONE]') break;

      let data = event.data;
      // event.data 可能是对象（新版 SDK）或 JSON 字符串（旧版/SSE 透传）
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

// 首页推荐用：流式收集 → parseRecommendJson。
// opts.messages 由调用方 promptBuilder 构造（首页 system prompt + user 候选）。
// 返回解析结果（{recommendations:[...]}），空内容返回 null。
// candidateMap 业务 join 校验留在页面（不在本模块）。
async function callAiRecommend(opts) {
  const { messages, maxEvents } = opts || {};
  const fullContent = await streamAiText(messages, { maxEvents });
  if (!fullContent || fullContent.trim().length === 0) return null;
  return parseRecommendJson(fullContent);
}

module.exports = {
  parseRecommendJson,
  tolerantParseRecommendations,
  streamAiText,
  callAiRecommend
};
