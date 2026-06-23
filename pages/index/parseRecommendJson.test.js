// parseRecommendJson 单元测试
// 运行：node pages/index/parseRecommendJson.test.js
//
// 这是为了复现并验证 "Unexpected number in JSON at position 71" 修复的回归测试。
// 根因：AI 返回的内容可能带 markdown 围栏、自然语言开场白或流式协议残留，
// 直接 JSON.parse 会失败。parseRecommendJson 提供多级兜底提取。

// 从 index.js 抽取被测函数（避免引入 wx/cloud 等小程序运行时依赖）：
// 这里直接复制 parseRecommendJson 的实现，确保与生产代码一致。
function parseRecommendJson(raw) {
  const cleaned = (raw || '').replace(/[\u200b-\u200d\ufeff]/g, '').trim();

  try { return JSON.parse(cleaned); } catch (e) { /* continue */ }

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch (e) { /* continue */ }
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (e) { /* continue */ }
  }

  const recs = tolerantParseRecommendations(cleaned);
  if (recs.length > 0) {
    return { recommendations: recs };
  }

  throw new Error('AI response is not valid JSON');
}

// 按字段名从（可能损坏的）AI 文本中容错提取推荐项。
function tolerantParseRecommendations(text) {
  if (!text) return [];
  const recs = [];
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

let passed = 0;
let failed = 0;

function assert(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failed++;
    console.error('  ✗ ' + name);
    console.error('    expected: ' + e);
    console.error('    actual:   ' + a);
  }
}

function assertThrows(name, fn) {
  try {
    fn();
    failed++;
    console.error('  ✗ ' + name + ' (expected throw, got none)');
  } catch (e) {
    passed++;
    console.log('  ✓ ' + name);
  }
}

console.log('parseRecommendJson tests\n');

// 1. 标准合法 JSON（最常见路径）
assert(
  'standard valid JSON',
  parseRecommendJson('{"recommendations":[{"poi_id":"0","reason":"很近"}]}'),
  { recommendations: [{ poi_id: '0', reason: '很近' }] }
);

// 2. 复现 position 71 风格的脏数据：JSON 前后有自然语言开场白
//    "好的，这是我的推荐：{...}" —— 直接 parse 会报 "Unexpected token / number"
assert(
  'json with natural-language preamble',
  parseRecommendJson('好的，根据你的需求推荐如下：{"recommendations":[{"poi_id":"2","reason":"评分高"}]}'),
  { recommendations: [{ poi_id: '2', reason: '评分高' }] }
);

// 3. markdown 围栏包裹
assert(
  'json wrapped in ```json fence',
  parseRecommendJson('```json\n{"recommendations":[{"poi_id":"1","reason":"好吃"}]}\n```'),
  { recommendations: [{ poi_id: '1', reason: '好吃' }] }
);

// 4. markdown 围栏（无 json 标记）
assert(
  'json wrapped in plain ``` fence',
  parseRecommendJson('```\n{"recommendations":[]}\n```'),
  { recommendations: [] }
);

// 5. 零宽字符污染
assert(
  'zero-width characters stripped',
  parseRecommendJson('\u200b{"recommendations":[]}\u200d'),
  { recommendations: [] }
);

// 6. reason 中含合法空格/标点/数字 —— 不能被破坏（回归老 bug：旧 .replace(/[ -]/g,'') 会删空格）
assert(
  'reason text with spaces and numbers preserved',
  parseRecommendJson('{"recommendations":[{"poi_id":"3","reason":"距离 500 米，评分 4.8 分"}]}'),
  { recommendations: [{ poi_id: '3', reason: '距离 500 米，评分 4.8 分' }] }
);

// 7. 空字符串
assertThrows('empty string throws', () => parseRecommendJson(''));

// 8. 纯文本无 JSON
assertThrows('plain text without JSON throws', () => parseRecommendJson('我今天不太想推荐'));

// 9. 只有左花括号
assertThrows('only opening brace throws', () => parseRecommendJson('{'));

// === 真实损坏样本（来自生产诊断日志，hy3-preview 流式丢字符）===
// run 3 的 fullContent：第二个条目 "poi_id" 退化为 "po_id"，且值的 :"/引号缺失
// 完整内容：{"recommendations":[{"poi_id":"2","reason":"距你近..."},{"po_id"44","reason":"小面..."},{...}]}
// JSON.parse 在 position 70 报 "Unexpected number"（那个裸 4）。这是原始 bug 报告的来源。
const realCorruptSample = '{"recommendations":[{"poi_id":"2","reason":"距你近评分高，咖啡配早餐很合适"},{"po_id"44","reason":"小面实惠，距离近老重庆早餐"},{"poi_id":"16","reason":"奶茶好喝，距你近价格也亲民"}]}';

assert(
  'real-world corrupt sample (hy3 drops poi_id chars) — recovers 2 valid items',
  parseRecommendJson(realCorruptSample),
  {
    recommendations: [
      // 第一项正常 → 提取
      { poi_id: '2', reason: '距你近评分高，咖啡配早餐很合适' },
      // 第二项 poi_id 损坏成 "po_id"44"：tolerantParse 跳过损坏的 poi_id，
      //   其 reason 会与前一个有效 poi_id 错配——我们用断言锁定：这一项不可挽救，
      //   会把 "小面..." 配到 poi_id=2。所以期望只验证前两项能挽救，整体长度=3。
      //   实际语义：bad item 被 callRecommend 的 candidateMap 校验滤掉。
      { poi_id: '16', reason: '奶茶好喝，距你近价格也亲民' }
    ]
  }
);

// 更精确地验证：损坏样本至少能挽救出 poi_id=2 和 poi_id=16 这两条合法推荐
assert(
  'real-world corrupt sample recovers poi_id 2 and 16',
  (() => {
    const r = parseRecommendJson(realCorruptSample);
    const ids = (r.recommendations || []).map((x) => x.poi_id);
    return ids.includes('2') && ids.includes('16');
  })(),
  true
);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
