// AI 情境引擎：给候选店打"情境适配分"（-0.3~+0.3）。
// 这是 AI 决策引擎重构的核心产物，被手气抽签和 AI甄选共用。
//
// 核心思路（见 06-27-mystery-ai-weighted-draw/design.md）：
// AI 不调全局权重（已被 sim 证伪），而是针对每家店给情境调整分——
// 引入"距离质量表达不了的信息"（类型是否适合场景、是否值得专程等）。
// sim 验证：午餐抬升快餐/晚餐抬升正餐，两场景 top3 零重叠。
//
// 本文件为 Step 0 版本：prompt 构造 + AI 调用 + 解析校验。
// 缓存/候选池精简留给 Step 1。本版用于真机验证 prompt 有效性。

const { streamAiText, parseRecommendJson } = require('./aiRecommend.js');
const { makePoiId } = require('./util.js');

// 情境分范围（防极端值破坏随机稳定性，见 design §6）
const ADJ_MIN = -0.3;
const ADJ_MAX = 0.3;
// 候选池精简上限（Step 1 启用，Step 0 传多少评多少）
const MAX_CANDIDATES = 15;

// 构造 system prompt
function buildSystemPrompt() {
  return '你是一个懂吃的本地向导。根据当前用餐场景，为每家候选店评估"情境适配度"。' +
    '正分(0~0.3)：适合本场景（如午餐场景给快餐+，因求快求近）。' +
    '负分(-0.3~0)：不适合（如午餐给火锅-，因太慢太重；下午茶给正餐-）。' +
    '0：中性。\n' +
    '原则：分值反映"距离和评分表达不了的情境判断"，不要因距离远/评分低就给负分（那些公式已处理）。' +
    '分值要有场景逻辑，不要全给 0。\n' +
    '必须严格返回 JSON：{"reason":"本场景选店倾向一句话","adjustments":{"poi_id值":分值,...}}。' +
    '必须为输入 candidates 里的每个 poi_id 都打分，分值是数字。';
}

// 构造 user prompt（精简字段，控制 token）
function buildUserPrompt(pois, scene) {
  const candidates = pois.map(function (p) {
    return {
      poi_id: p.poi_id || makePoiId(p),
      name: p.name || '',
      type: p.type || '',
      distance: p.distance || 0,
      rating: p.rating || null,
      cost: p.cost || null
    };
  });
  return JSON.stringify({ scene: scene, candidates: candidates });
}

// 解析 AI 返回，校验 + clamp
// 返回 { adjustments: {poi_id: number}, reason: string } 或 null
function parseContextResult(raw, validPoiIds) {
  if (!raw || !raw.trim()) {
    console.log('[Step0诊断] parse失败: raw为空');
    return null;
  }
  let parsed;
  try {
    parsed = parseRecommendJson(raw);
  } catch (e) {
    console.log('[Step0诊断] parseRecommendJson抛异常:', e && (e.message || e));
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    console.log('[Step0诊断] parse结果非对象:', typeof parsed, parsed);
    return null;
  }
  console.log('[Step0诊断] parse成功，parsed字段:', Object.keys(parsed));

  const reason = (typeof parsed.reason === 'string') ? parsed.reason : '';
  const rawAdj = (parsed.adjustments && typeof parsed.adjustments === 'object') ? parsed.adjustments : null;
  if (!rawAdj) return null;

  const validSet = new Set(validPoiIds);
  const adjustments = {};
  let hasAny = false;
  // 只保留输入候选内的 poi_id，clamp 分值
  Object.keys(rawAdj).forEach(function (id) {
    if (!validSet.has(id)) return; // 丢弃 AI 编造的 poi_id
    var v = rawAdj[id];
    if (typeof v === 'string') { v = parseFloat(v); }
    if (typeof v !== 'number' || isNaN(v)) return;
    if (v < ADJ_MIN) v = ADJ_MIN;
    if (v > ADJ_MAX) v = ADJ_MAX;
    adjustments[id] = v;
    hasAny = true;
  });

  if (!hasAny) return null; // 一个有效分都没有，视为失败
  return { adjustments: adjustments, reason: reason };
}

// 主函数（Step 0 版：无缓存，直接调 AI）
// pois: 标准化 POI 数组
// scene: 场景名
// 返回 Promise<{adjustments, reason} | null>（null = 失败，调用方回退纯公式）
async function scoreSceneContext(pois, scene) {
  if (!pois || pois.length === 0) return null;

  // 候选池精简（Step 1 会改为预排序取 topN，Step 0 直接取前 MAX_CANDIDATES 个）
  var pool = pois.slice(0, MAX_CANDIDATES);
  var validPoiIds = pool.map(function (p) { return p.poi_id || makePoiId(p); });

  var messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(pool, scene) }
  ];

  try {
    // maxEvents 提高：情境分 JSON 较长（15家店×~20字符+reason≈300+字符），
    // 默认 maxEvents=100 会导致流式输出被截断（实测 JSON 不完整）。
    // 设 500 给足余量，避免截断。
    var fullContent = await streamAiText(messages, { maxEvents: 500 });
    // ⚠️ Step0 诊断日志（验证后删除）
    console.log('[Step0诊断] streamAiText 返回原始内容(前300字符):', (fullContent || '').slice(0, 300));
    console.log('[Step0诊断] 返回类型:', typeof fullContent, '长度:', (fullContent || '').length);
    var result = parseContextResult(fullContent, validPoiIds);
    console.log('[Step0诊断] parseContextResult:', result ? '成功' : 'null(解析失败或无有效分)');
    return result; // null 或 {adjustments, reason}
  } catch (e) {
    console.error('[Step0诊断] streamAiText 抛异常:', e && (e.message || e.errMsg || e));
    return null;
  }
}

module.exports = {
  scoreSceneContext,
  // 暴露内部函数供 Step 0 测试 + Step 1 单测
  buildSystemPrompt,
  buildUserPrompt,
  parseContextResult,
  ADJ_MIN,
  ADJ_MAX,
  MAX_CANDIDATES
};
