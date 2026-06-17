// 盲盒推荐算法模块
// 基于 E&E（探索与利用）最佳实践：Epsilon-Greedy + 长尾加权 + 会话去重
// 详见 .trellis/tasks/06-14-mystery-box-feature/design.md §3

const { SCENE_KEYWORDS } = require('../config/sceneKeywords.js');

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
function longTailBonus(poi) {
  const name = poi.name || '';
  const isChain = CHAIN_KEYWORDS.some((k) => name.indexOf(k) >= 0);
  return isChain ? 0.3 : 1.0;
}

// 时段感知加权：匹配当前时段 ×1.3，不匹配 ×0.7（软引导，不硬过滤）
function timeAwareMultiplier(poi, currentScene) {
  const keywords = SCENE_KEYWORDS[currentScene];
  if (!keywords) return 1.0; // 随便吃点 / 未知场景不加权
  const haystack = (poi.name || '') + (poi.type || '') + (poi.typecode || '');
  const isMatch = keywords.some((k) => haystack.indexOf(k) >= 0);
  return isMatch ? 1.3 : 0.7;
}

// ===== 质量门槛 =====

// 质量门槛筛选：保证盲盒≠垃圾推荐
function qualifyFilter(poi) {
  const hasRating = poi.rating && poi.rating >= 3.5;
  const nearbyNoRating = !poi.rating && (poi.distance || 0) <= 500;
  const inRange = (poi.distance || 0) <= 3000;
  return (hasRating || nearbyNoRating) && inRange;
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

  // 1. 质量门槛 + 会话去重
  const openedSet = new Set((openedIds || []).map(String));
  const candidates = pois
    .map((poi, idx) => ({ poi, poi_id: String(idx) }))
    .filter((c) => qualifyFilter(c.poi))
    .filter((c) => !openedSet.has(c.poi_id));

  if (candidates.length === 0) return null; // 池子耗尽

  // 2. Epsilon-Greedy 决策
  if (Math.random() < epsilon) {
    // 探索：纯随机
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // 利用：加权随机
  const weighted = candidates.map((c) => ({
    ...c,
    weight: calculateWeight(c.poi, currentScene)
  }));
  return weightedRandomPick(weighted);
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
  const type = poi.type || '餐饮';
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
  // 暴露子函数便于单元测试
  distanceScore,
  qualityScore,
  longTailBonus,
  timeAwareMultiplier
};
