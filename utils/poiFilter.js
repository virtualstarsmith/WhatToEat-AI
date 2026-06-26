// POI 筛选工具：AI 甄选页快捷筛选栏背后的纯过滤层。
// 设计原则（见 06-26-ai-pick-filter-bar/design.md）：
//   - 纯函数，无 wx 依赖，可被单测 require（与 scoring/aiRecommend 可测性模式一致）
//   - 不污染 scoring.js 的单一职责（打分）；过滤是独立的布尔关注点
//   - 快餐/正餐关键词复用 config/scenes.js，不硬编码（避免第二份关键词表 drift）
//   - cost 宽松包含：高德 cost 覆盖率低，cost=null 一律保留（宁可多显示不可漏显示）
//   - 档位上限语义：medium(≤50) 包含 cheap(≤30) 的店

const { getScene } = require('../config/scenes.js');

// ===== 快餐/正餐关键词集（复用 scenes.js，单一事实源）=====
// 快餐：午餐.快餐 alias（简餐/便当/盖饭/麻辣烫/炒饭/饺子...）+ 早餐面点/粉面（轻食类）
// 正餐：晚餐.正餐 + 晚餐.菜系 + 晚餐.火锅烧烤（正餐/酒楼/川菜/火锅/海鲜...）
// 茶饮/咖啡/甜品（下午茶）故意不纳入 → 选快餐/正餐时被过滤，符合"我要吃饭"语义。

function collectTerms(sceneName) {
  const scene = getScene(sceneName);
  if (!scene || !scene.match) return [];
  const terms = [];
  for (const canon of Object.keys(scene.match)) {
    terms.push(canon);
    for (const alias of scene.match[canon]) terms.push(alias);
  }
  return terms;
}

const FASTFOOD_TERMS = collectTerms('午餐').concat(collectTerms('早餐'));
// 午餐已含「快餐」组；早餐含面点/粉面/粥品（包子/面/粥等轻食）
const FORMAL_TERMS = collectTerms('晚餐');
// 晚餐含正餐/火锅烧烤/菜系三组

// 子串命中（与 matchesScene 一致，不做词边界正则：餐饮文本无「粉」误命中「粉笔」的现实风险）
function matchesAnyTerm(poi, terms) {
  const haystack = `${poi.name || ''}${poi.type || ''}`;
  return terms.some((t) => haystack.indexOf(t) >= 0);
}

// ===== 价格档位（上限语义，宽松包含 null）=====
// cheap: ≤30；medium: ≤50（含 ≤30）。cost=null 一律保留。
function matchPrice(poi, priceFilter) {
  if (!priceFilter) return true;
  if (poi.cost == null) return true; // 宽松包含：无人均数据的店保留
  if (priceFilter === 'cheap') return poi.cost <= 30;
  if (priceFilter === 'medium') return poi.cost <= 50;
  return true;
}

// ===== 距离档位 =====
// near: ≤500m；walk: ≤1000m（含 ≤500）
function matchDistance(poi, distanceFilter) {
  if (!distanceFilter) return true;
  const d = poi.distance || 0;
  if (distanceFilter === 'near') return d <= 500;
  if (distanceFilter === 'walk') return d <= 1000;
  return true;
}

// ===== 类别档位（复用 scenes 关键词）=====
function matchCategory(poi, categoryFilter) {
  if (!categoryFilter) return true;
  if (categoryFilter === 'fastfood') return matchesAnyTerm(poi, FASTFOOD_TERMS);
  if (categoryFilter === 'formal') return matchesAnyTerm(poi, FORMAL_TERMS);
  return true;
}

// ===== 组合入口 =====
// pois: 标准化 POI 数组（getPoi 返回）
// filters: { price, distance, category }，每字段为档位 key 或 '' （不限）
// 返回: 过滤后的新数组（浅拷贝，不改原数组）
function filterPois(pois, filters) {
  const f = filters || {};
  return (pois || []).filter((poi) =>
    matchPrice(poi, f.price) &&
    matchDistance(poi, f.distance) &&
    matchCategory(poi, f.category)
  );
}

module.exports = {
  filterPois,
  // 暴露子函数便于单测
  matchPrice,
  matchDistance,
  matchCategory,
  FASTFOOD_TERMS,
  FORMAL_TERMS
};
