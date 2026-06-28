// AI 情境引擎：给候选店打"情境适配分"（-0.3~+0.3）。
// 这是 AI 决策引擎重构的核心产物，被手气抽签和 AI甄选共用。
//
// 核心思路（见 06-27-mystery-ai-weighted-draw/design.md）：
// AI 不调全局权重（已被 sim 证伪），而是针对每家店给情境调整分——
// 引入"距离质量表达不了的信息"（类型是否适合场景、是否值得专程等）。
// 实测验证：AI 能精准识别场景适配（下午茶给茶饮+、正餐-），方案成立。
//
// 缓存策略：场景 + 候选池指纹命中缓存，避免重复调用。
// 精简策略：按 base score 预排序取 topN 送 AI（控制 token + AI 评分质量）。
// 兜底：AI 失败/超时返回 null，调用方回退纯公式。

const { streamAiText } = require('./aiRecommend.js');
const { parseRecommendJson } = require('./aiRecommend.js');

// 情境分范围（防极端值破坏随机稳定性，见 design §6）
const ADJ_MIN = -0.3;
const ADJ_MAX = 0.3;
// 候选池精简上限（按 base 预排序取 topN 送 AI，控制 token）
const MAX_CANDIDATES = 15;
// AI 超时（毫秒）
const AI_TIMEOUT = 8000;
// 流式分块上限（情境分 JSON 较长，默认 100 会截断，见 Step0 实测）
const MAX_EVENTS = 500;

// ===== 模块级缓存（页面切换间保持）=====
// key = scene + 候选池指纹（poi_id 排序拼接）
const _cache = new Map();

function makePoiIdLocal(poi) {
  // 与 utils/util.js makePoiId 一致的稳定键（避免循环依赖，本地复刻）
  if (poi.poi_id) return poi.poi_id;
  return (poi.location || '') + '|' + (poi.name || '');
}

// 简单字符串 hash（FNV-1a 变体，足够区分候选池指纹）
function simpleHash(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function cacheKey(pois, scene) {
  var ids = pois.map(function (p) { return makePoiIdLocal(p); }).sort().join(',');
  return scene + '|' + simpleHash(ids);
}

// ===== base score 预排序（精简候选池用）=====
// 与 mysteryBox.calculateWeight 同源的精简版，仅用于"选 topN 送 AI"，不影响最终选店
function baseScoreForSort(poi) {
  var distance = poi.distance || 0;
  var rating = poi.rating;
  var dScore = Math.exp(-distance / 800);
  var qScore = rating ? rating / 5 : 0.3;
  return 0.5 * dScore + 0.5 * qScore;
}

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
  var candidates = pois.map(function (p) {
    return {
      poi_id: p.poi_id || makePoiIdLocal(p),
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
  if (!raw || !raw.trim()) return null;
  var parsed;
  try {
    parsed = parseRecommendJson(raw);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  var reason = (typeof parsed.reason === 'string') ? parsed.reason : '';
  var rawAdj = (parsed.adjustments && typeof parsed.adjustments === 'object') ? parsed.adjustments : null;
  if (!rawAdj) return null;

  var validSet = new Set(validPoiIds);
  var adjustments = {};
  var hasAny = false;
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

  if (!hasAny) return null;
  return { adjustments: adjustments, reason: reason };
}

// 带超时的 Promise 包装
function withTimeout(promise, ms) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () {
      if (!done) { done = true; resolve(null); }
    }, ms);
    promise.then(function (v) {
      if (!done) { done = true; clearTimeout(timer); resolve(v); }
    }, function () {
      if (!done) { done = true; clearTimeout(timer); resolve(null); }
    });
  });
}

// 主函数
// pois: 标准化 POI 数组（完整池，内部精简）
// scene: 场景名
// 返回 Promise<{adjustments, reason} | null>（null = 失败/超时，调用方回退纯公式）
async function scoreSceneContext(pois, scene) {
  if (!pois || pois.length === 0) return null;

  // 1. 缓存命中检查
  var key = cacheKey(pois, scene);
  if (_cache.has(key)) return _cache.get(key);

  // 2. 候选池精简：按 base 预排序取 topN（控制 token + 保证 AI 评的是值得评的店）
  var sortedPool = pois.slice().sort(function (a, b) {
    return baseScoreForSort(b) - baseScoreForSort(a);
  });
  var pool = sortedPool.slice(0, MAX_CANDIDATES);
  var validPoiIds = pool.map(function (p) { return makePoiIdLocal(p); });

  // 3. 构造消息 + 调用 AI（带超时）
  var messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(pool, scene) }
  ];

  var self = this;
  var aiPromise = (async function () {
    try {
      var fullContent = await streamAiText(messages, { maxEvents: MAX_EVENTS });
      return parseContextResult(fullContent, validPoiIds);
    } catch (e) {
      return null;
    }
  })();

  var result = await withTimeout(aiPromise, AI_TIMEOUT);

  // 4. 缓存（成功结果，null 也缓存避免短时间重复失败调用？—— 不缓存 null，允许下次重试）
  if (result) {
    _cache.set(key, result);
  }
  return result;
}

// 清空缓存（测试用 / 位置显著变化时）
function clearCache() {
  _cache.clear();
}

module.exports = {
  scoreSceneContext,
  clearCache,
  // 暴露内部函数供单测
  buildSystemPrompt,
  buildUserPrompt,
  parseContextResult,
  baseScoreForSort,
  cacheKey,
  ADJ_MIN,
  ADJ_MAX,
  MAX_CANDIDATES
};
