// 盲盒推荐算法模块
// 基于 E&E（探索与利用）最佳实践：Epsilon-Greedy + 长尾加权 + 会话去重
// 详见 .trellis/tasks/06-14-mystery-box-feature/design.md §3

const { SCENE_KEYWORDS } = require('../config/sceneKeywords.js');
const { normalizePoiType } = require('./util.js');

// ===== 评分相关（复用 index.js 既有公式）=====

// 距离评分：指数衰减，800m 约步行 10 分钟
function distanceScore(distance) {
  return Math.exp(-distance / 800);
}

// 质量评分：无评分给 0.3（降权而非中位数）
function qualityScore(rating) {
  return rating ? rating / 5.0 : 0.3;
}

// ===== 盲盒专属加权 =====

// 常见连锁品牌（用于长尾降权，让特色小店更易被开出）
const CHAIN_KEYWORDS = [
  '麦当劳', '肯德基', '星巴克', '蜜雪冰城', '必胜客', '汉堡王',
  '华莱士', '德克士', '瑞幸', 'luckin', 'CoCo', 'coco', '一点点',
  '茶百道', '喜茶', '奈雪', '海底捞', '呷哺呷哺', '真功夫', '永和大王'
];

// 长尾加成：连锁店降权，特色小店加权（参考"逆用户频率"长尾加权思想）
// 连锁取 0.2（而非 0.3）：在 20% 的长尾维度上进一步压制连锁，让特色小店更易被开出
function longTailBonus(poi) {
  const name = poi.name || '';
  const isChain = CHAIN_KEYWORDS.some((k) => name.indexOf(k) >= 0);
  return isChain ? 0.2 : 1.0;
}

// 时段感知加权：匹配当前时段 ×1.2，不匹配 ×0.85（软引导，不硬过滤）
// 系数经 06-21-mystery-scene-tuning 调整：原 1.3/0.7 惩罚不对称且过重，
// 导致近距好店因品类词未命中（如"面馆"未命中午餐"面食"）被远处匹配店反超。
// 弱化惩罚后软引导仍生效，但未命中好店不再被严重压制。
function timeAwareMultiplier(poi, currentScene) {
  const keywords = SCENE_KEYWORDS[currentScene];
  if (!keywords) return 1.0; // 随便吃点 / 未知场景不加权
  const haystack = (poi.name || '') + (poi.type || '') + (poi.typecode || '');
  const isMatch = keywords.some((k) => haystack.indexOf(k) >= 0);
  return isMatch ? 1.2 : 0.85;
}

// ===== 质量门槛 =====

// 质量门槛筛选：保证盲盒≠垃圾推荐
// 无评分店放宽到 1500m（原 500m 过严，会误杀郊区/低密度区的特色小店，
// 与 longTailBonus「捧特色小店」的意图矛盾）
function qualifyFilter(poi) {
  const hasRating = poi.rating && poi.rating >= 3.5;
  const nearbyNoRating = !poi.rating && (poi.distance || 0) <= 1500;
  const inRange = (poi.distance || 0) <= 3000;
  return (hasRating || nearbyNoRating) && inRange;
}

// ===== 稳定标识 =====

// 生成 POI 稳定唯一标识。
// 复合键 `location|name`，与云函数 getPoi/index.js 的去重键完全一致。
// 用它而非数组下标，可保证池子顺序变化（刷新/翻页/切定位）后同一店铺仍为同一 id，
// 从而让会话去重真正生效。
function makePoiId(poi) {
  return `${poi.location || ''}|${poi.name || ''}`;
}

// ===== 权重计算 =====

// 综合权重：40% 距离 + 40% 质量 + 20% 长尾惊喜，再乘时段感知
function calculateWeight(poi, currentScene) {
  const base = 0.4 * distanceScore(poi.distance)
             + 0.4 * qualityScore(poi.rating)
             + 0.2 * longTailBonus(poi);
  return base * timeAwareMultiplier(poi, currentScene);
}

// ===== 加权随机选择 =====

// 加权随机：权重高的更易被选中，但谁都有机会（转盘式）
function weightedRandomPick(candidates) {
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight <= 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  let random = Math.random() * totalWeight;
  for (const c of candidates) {
    random -= c.weight;
    if (random <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

// ===== 主算法入口 =====

// Epsilon-Greedy 盲盒推荐
// pois: getPoi 返回的标准化 POI 数组
// openedIds: 本次会话已开过的 poi_id 字符串数组（用于去重）
// currentScene: 当前时段场景（'早餐' | '午餐' | ...）
// 返回: { poi_id, poi } 或 null（池子耗尽）
function mysteryBoxRecommend(pois, openedIds, currentScene) {
  const epsilon = 0.3; // 30% 探索 / 70% 利用

  // 1. 质量门槛 + 会话去重（poi_id 用 location|name 稳定键，保证池子顺序变化后去重仍生效）
  const openedSet = new Set((openedIds || []).map(String));
  const candidates = pois
    .map((poi) => ({ poi, poi_id: makePoiId(poi) }))
    .filter((c) => qualifyFilter(c.poi))
    .filter((c) => !openedSet.has(c.poi_id));

  if (candidates.length === 0) return null; // 池子耗尽

  // 2. 预计算权重（探索与利用共用；候选通常仅几十家，开销可忽略）
  const weighted = candidates.map((c) => ({
    ...c,
    weight: calculateWeight(c.poi, currentScene)
  }));

  // 3. Epsilon-Greedy 决策
  if (Math.random() < epsilon) {
    // 探索：中段探索，而非纯随机。
    // 按权重升序排序后取 30%~70% 分位的中段池随机选——既避免纯随机开出离谱结果，
    // 又能开出"纯利用"选不到的次优好店，保留盲盒惊喜性。
    return midBandPick(weighted);
  }

  // 利用：加权随机
  return weightedRandomPick(weighted);
}

// 中段探索：按权重升序排序，从 30%~70% 分位的子集里随机挑一个。
// 候选过少（< 3）时退化为「取权重较高者」，避免选出明显劣质结果。
function midBandPick(weighted) {
  const sorted = weighted.slice().sort((a, b) => (a.weight || 0) - (b.weight || 0));
  const n = sorted.length;
  if (n < 3) {
    // 候选极少：直接取排序后最高权重者（避免在 2 家里选了更差的）
    return sorted[n - 1];
  }
  const lo = Math.floor(n * 0.3);
  const hi = Math.ceil(n * 0.7);
  const band = sorted.slice(lo, hi); // [lo, hi)
  return band[Math.floor(Math.random() * band.length)];
}

// ===== 场景识别辅助 =====

// 检测某 POI 所属的用餐场景（基于关键词）
function detectPoiScene(poi) {
  const haystack = (poi.name || '') + (poi.type || '') + (poi.typecode || '');
  for (const scene of Object.keys(SCENE_KEYWORDS)) {
    const keywords = SCENE_KEYWORDS[scene];
    if (!keywords) continue;
    if (keywords.some((k) => haystack.indexOf(k) >= 0)) {
      return scene;
    }
  }
  return ''; // 无法识别
}

// 判断 POI 场景与当前时段是否严重不匹配
// 只在"明确属于某场景"且"与当前时段明显冲突"时返回 true
function isSceneMismatch(poiScene, currentScene) {
  if (!poiScene || !currentScene) return false;
  if (poiScene === currentScene) return false;

  // 定义严重冲突的场景对（时段完全相反）
  const conflicts = {
    '早餐': ['夜宵'],
    '夜宵': ['早餐'],
    '下午茶/饮品': ['早餐', '夜宵']
  };
  const conflictList = conflicts[currentScene] || [];
  return conflictList.indexOf(poiScene) >= 0;
}

// ===== 推荐理由生成（模板化，不调用 AI）=====

function formatDistanceZh(d) {
  if (d == null) return '附近';
  return d >= 1000 ? Math.round(d / 1000) + '公里' : Math.round(d) + '米';
}

function formatRatingZh(r) {
  return r ? r.toFixed(1) + '分' : '好评';
}

// 生成盲盒专属推荐理由
function generateMysteryReason(poi, currentScene) {
  const distanceText = formatDistanceZh(poi.distance);
  const ratingText = formatRatingZh(poi.rating);
  const type = normalizePoiType(poi.type);
  const name = poi.name || '神秘店铺';

  // 时段严重不匹配：友好提示（第3层硬提示）
  const poiScene = detectPoiScene(poi);
  if (isSceneMismatch(poiScene, currentScene)) {
    const sceneLabel = poiScene === '下午茶/饮品' ? '下午茶' : poiScene;
    return `🌙 盲盒开出「${name}」（${sceneLabel}店），当前是${currentScene}时段，注意营业时间`;
  }

  // 正常盲盒文案（随机选择，突出惊喜/幸运调性）
  const reasons = [
    `🎁 恭喜开出「${name}」！${ratingText}的好店`,
    `✨ 盲盒惊喜：这家${type}距离仅${distanceText}`,
    `🌟 惊喜发现！「${name}」等你来尝鲜`,
    `🍀 今日幸运：${ratingText}的${type}推荐给你`,
    `🎯 盲盒精选：藏在${distanceText}外的宝藏小店`,
    `💫 神秘开箱：「${name}」，${ratingText}值得一试`,
    `🌈 惊喜降临：「${name}」，距离${distanceText}`
  ];
  return reasons[Math.floor(Math.random() * reasons.length)];
}

module.exports = {
  mysteryBoxRecommend,
  generateMysteryReason,
  detectPoiScene,
  isSceneMismatch,
  qualifyFilter,
  calculateWeight,
  makePoiId,
  // 暴露子函数便于单元测试
  distanceScore,
  qualityScore,
  longTailBonus,
  timeAwareMultiplier
};
