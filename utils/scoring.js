// 共享评分原语与参数化打分聚合。
// 把首页（求稳 0.5/0.5）与盲盒（求惊喜 0.4/0.4/0.2）共用的距离/质量评分收敛为一份，
// 两页只传不同权重 profile，而非各自复制 distanceScore/qualityScore（drift 隐患）。
// 见 06-24-scoring-module；对应老许方法论：规格统一、参数区分。
//
// 本模块只负责「原语 + 聚合」，不含场景乘数（sceneMultiplier / timeAwareMultiplier）、
// 长尾加成（longTailBonus）、topN 等页面专属逻辑——这些留在各自文件，避免过度抽象。

const { makePoiId } = require('./util.js');

// 距离评分：指数衰减，800m 约步行 10 分钟。
function distanceScore(distance) {
  return Math.exp(-distance / 800);
}

// 质量评分：无评分给 0.3（降权而非中位数）。
function qualityScore(rating) {
  return rating ? rating / 5.0 : 0.3;
}

// 通用打分聚合。
// pois: getPoi 返回的标准化 POI 数组
// opts.weights: { d, q, longtail? } —— 距离/质量/长尾权重（首页 {d:0.5,q:0.5}，盲盒 {d:0.4,q:0.4,longtail:0.2}）
// opts.bonus(poi): 可选长尾加成函数（首页不传；盲盒传 longTailBonus）。仅当 weights.longtail>0 时参与。
// opts.matcher(poi): 可选场景乘数函数（首页传 sceneMultiplier；盲盒传 timeAwareMultiplier）。不传则不乘。
// opts.excludeIds: 排除 id 集（命中后 score*=0.6，沿用首页既有惩罚系数）。
// 返回: [{ poi_id, poi, score, matched }] —— poi_id 用 makePoiId 稳定标识。
//   matched: matcher 命中（或无 matcher）为 true，供首页 topNWithExplore 划分匹配档/探索档。
function scoreCandidates(pois, opts) {
  const { weights = {}, bonus, matcher, excludeIds } = opts || {};
  const dW = weights.d || 0;
  const qW = weights.q || 0;
  const ltW = weights.longtail || 0;
  const excludeSet = new Set((excludeIds || []).map((id) => String(id)));

  return pois.map((poi) => {
    const base = dW * distanceScore(poi.distance)
               + qW * qualityScore(poi.rating)
               + ltW * (bonus ? bonus(poi) : 0);
    const matched = !matcher || matcher(poi) >= 1.0;
    let score = matcher ? base * matcher(poi) : base;
    const poiId = makePoiId(poi);
    if (excludeSet.has(poiId)) score *= 0.6;
    return { poi_id: poiId, poi, score, matched };
  });
}

module.exports = {
  distanceScore,
  qualityScore,
  scoreCandidates
};
