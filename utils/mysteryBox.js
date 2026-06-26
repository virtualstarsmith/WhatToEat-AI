// 盲盒推荐算法模块
// 基于 E&E（探索与利用）最佳实践：Epsilon-Greedy + 长尾加权 + 会话去重
// 详见 .trellis/tasks/06-14-mystery-box-feature/design.md §3

const { matchesScene, getScene, SCENE_NAMES } = require('../config/scenes.js');
const { normalizePoiType, makePoiId } = require('./util.js');
const { distanceScore, qualityScore } = require('./scoring.js');

// ===== 评分原语（自 utils/scoring.js 引入，与首页同源，见 06-24-scoring-module）=====

// ===== 盲盒专属加权 =====

// 常见连锁品牌（用于长尾降权，让特色小店更易被开出）
const CHAIN_KEYWORDS = [
  '麦当劳', '肯德基', '星巴克', '蜜雪冰城', '必胜客', '汉堡王',
  '华莱士', '德克士', '瑞幸', 'luckin', 'CoCo', 'coco', '一点点',
  '茶百道', '喜茶', '奈雪', '海底捞', '呷哺呷哺', '真功夫', '永和大王'
];

// 长尾加成：连锁店降权，特色小店加权（参考"逆用户频率"长尾加权思想）
// 分级（06-27-draw-algo 评审修正：无评分店不再享受满格，避免开出无信息垃圾店）：
//   连锁 → 0.2（压制连锁，保留抽签惊喜性）
//   非连锁+有评分 → 1.0（真·特色小店，鼓励）
//   非连锁+无评分 → 0.5（信息不足，适度降权；旧值 1.0 会让无评分苍蝇馆反超高分连锁）
function longTailBonus(poi) {
  const name = poi.name || '';
  const isChain = CHAIN_KEYWORDS.some((k) => name.indexOf(k) >= 0);
  if (isChain) return 0.2;
  return poi.rating ? 1.0 : 0.5;
}

// 时段感知加权：匹配当前时段 ×1.2，不匹配 ×0.85（软引导，不硬过滤）
// 系数经 06-21-mystery-scene-tuning 调整：原 1.3/0.7 惩罚不对称且过重，
// 导致近距好店因品类词未命中（如"面馆"未命中午餐"面食"）被远处匹配店反超。
// 弱化惩罚后软引导仍生效，但未命中好店不再被严重压制。
function timeAwareMultiplier(poi, currentScene) {
  // 系数（1.2/0.85）不变；匹配算法统一走 config/scenes.js 的 matchesScene（canonical+alias）。
  // 随便吃点 / 未知场景（空 match）matchesScene 恒 true → 不施加软引导。
  if (matchesScene(currentScene, poi)) return 1.2;
  return 0.85;
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
// makePoiId 现统一从 utils/util.js 引入（poi_id 优先 / location|name 兜底），
// 见 06-24-poi-id-stable。本模块仅消费，不再自定义。

// ===== 权重计算 =====

// 综合权重：40% 距离 + 40% 质量 + 20% 长尾惊喜，再乘时段感知
function calculateWeight(poi, currentScene) {
  const base = 0.4 * distanceScore(poi.distance)
             + 0.4 * qualityScore(poi.rating)
             + 0.2 * longTailBonus(poi);
  return base * timeAwareMultiplier(poi, currentScene);
}

// ===== 加权随机选择 =====

// 加权随机：权重高的更易被选中，但谁都有机会（转盘式）。
// p 为幂次：p=1（默认）即原加权随机；p<1 压缩权重差距，让长尾更易被选中。
//   探索档用 p=0.5（√weight），利用档用 p=1.0（weight）。
//   依据 06-27-draw-algo-bimodal-explore sim 验证：p=0.5 头部12%/长尾33%，命中手气体感。
function weightedRandomPick(candidates, p) {
  var power = (p == null) ? 1 : p;
  var weights = candidates.map(function (c) { return Math.pow(c.weight || 0, power); });
  var totalWeight = weights.reduce(function (sum, w) { return sum + w; }, 0);
  if (totalWeight <= 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  var random = Math.random() * totalWeight;
  for (var i = 0; i < candidates.length; i++) {
    random -= weights[i];
    if (random <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// ===== 探索策略 =====

// 探索档幂次：√weight 压缩权重差距，让长尾冷门店也有合理开出概率。
// 由 utils/mysteryBox.sim.js 网格搜索验证：p=0.5 时头部(top10%)开出 ~12%、
// 长尾(bottom40%)开出 ~33%，命中"手气爆棚稀缺、冷门惊喜常态"的产品体感。
// （softmax 因 exp 放大差距导致头部通吃，已验证不适用，详见 design §2。）
var EXPLORE_POWER = 0.5;

// reason 档位判定：按选中店在池中的权重排名分位定 tier（事后统计，非算法分支）。
//   top 20%  → 'explore-head'  （手气爆棚，文案强调高分/超近）
//   bottom 40% → 'explore-tail' （冷门惊喜，文案强调没听过/宝藏）
//   其余     → 'explore-mid'   （中性）
function tierByRank(picked, weighted) {
  var sorted = weighted.slice().sort(function (a, b) { return (b.weight || 0) - (a.weight || 0); });
  var n = sorted.length;
  var rank = -1;
  for (var i = 0; i < n; i++) {
    if (sorted[i].poi_id === picked.poi_id) { rank = i; break; }
  }
  if (rank < 0) return 'explore-mid';
  if (rank < Math.max(1, Math.floor(n * 0.2))) return 'explore-head';
  if (rank >= Math.floor(n * 0.6)) return 'explore-tail';
  return 'explore-mid';
}

// ===== 主算法入口 =====

// Epsilon-Greedy 抽签推荐
// pois: getPoi 返回的标准化 POI 数组
// openedIds: 本次会话已开过的 poi_id 字符串数组（用于去重）
// currentScene: 当前时段场景（'早餐' | '午餐' | ...）
// 返回: { poi_id, poi, fromExplore, tier } 或 null（池子耗尽）
//   fromExplore=true 表示本次由"探索档"选出，页面据此决定是否调 AI 生成惊喜理由。
//   tier: 'exploit'(利用) | 'explore-head'(头部/手气爆棚) | 'explore-tail'(长尾/冷门惊喜) | 'explore-mid'(中段)
function mysteryBoxRecommend(pois, openedIds, currentScene) {
  var epsilon = 0.15; // 15% 探索 / 85% 利用（探索用降幂加权，质量高于纯随机，比例可降）

  // 1. 质量门槛 + 会话去重（poi_id 用 location|name 稳定键，保证池子顺序变化后去重仍生效）
  var openedSet = new Set((openedIds || []).map(String));
  var candidates = pois
    .map(function (poi) { return { poi: poi, poi_id: makePoiId(poi) }; })
    .filter(function (c) { return qualifyFilter(c.poi); })
    .filter(function (c) { return !openedSet.has(c.poi_id); });

  if (candidates.length === 0) return null; // 池子耗尽

  // 2. 预计算权重（探索与利用共用；候选通常仅几十家，开销可忽略）
  var weighted = candidates.map(function (c) {
    return Object.assign({}, c, { weight: calculateWeight(c.poi, currentScene) });
  });

  // 3. Epsilon-Greedy 决策
  if (Math.random() < epsilon) {
    // 探索档：降幂加权随机 P∝√weight——压缩权重差距，长尾冷门店也有合理开出概率，
    // 既避免纯随机的离谱结果，又能开出"纯利用"选不到的次优/冷门好店。
    var picked = weightedRandomPick(weighted, EXPLORE_POWER);
    var tier = tierByRank(picked, weighted);
    return { poi_id: picked.poi_id, poi: picked.poi, fromExplore: true, tier: tier };
  }

  // 利用档：加权随机（偏头部，保稳）
  var picked2 = weightedRandomPick(weighted);
  return { poi_id: picked2.poi_id, poi: picked2.poi, fromExplore: false, tier: 'exploit' };
}

// ===== 场景识别辅助 =====

// 检测某 POI 所属的用餐场景（基于 canonical+alias）
function detectPoiScene(poi) {
  for (const sceneName of SCENE_NAMES) {
    const scene = getScene(sceneName);
    if (!scene || !scene.match || Object.keys(scene.match).length === 0) continue; // 跳过 随便吃点（空 match 恒 true）
    if (matchesScene(sceneName, poi)) {
      return sceneName;
    }
  }
  return ''; // 无法识别
}

// 判断 POI 场景与当前时段是否严重不匹配
// 只在"明确属于某场景"且"与当前时段明显冲突"时返回 true
// 冲突规则统一来自 config/scenes.js 的 scene.conflicts（已补全 6 场景）。
function isSceneMismatch(poiScene, currentScene) {
  if (!poiScene || !currentScene) return false;
  if (poiScene === currentScene) return false;
  // 冲突是对称的：任一方声明与另一方冲突即视为严重不匹配（早餐↔夜宵、下午茶↔早餐/夜宵）。
  const cur = getScene(currentScene);
  const poi = getScene(poiScene);
  const curConflicts = (cur && cur.conflicts) || [];
  const poiConflicts = (poi && poi.conflicts) || [];
  return curConflicts.indexOf(poiScene) >= 0 || poiConflicts.indexOf(currentScene) >= 0;
}

// ===== 推荐理由生成（模板化，不调用 AI）=====

function formatDistanceZh(d) {
  if (d == null) return '附近';
  return d >= 1000 ? Math.round(d / 1000) + '公里' : Math.round(d) + '米';
}

function formatRatingZh(r) {
  return r ? r.toFixed(1) + '分' : '好评';
}

// 生成抽签专属推荐理由（模板化，不调用 AI）。
// tier 来自 mysteryBoxRecommend 返回值，决定文案调性（见 REASONS_BY_TIER）。
// 兼容旧调用：tier 未传时走 exploit 档（中性）。
function generateMysteryReason(poi, currentScene, tier) {
  const distanceText = formatDistanceZh(poi.distance);
  const ratingText = formatRatingZh(poi.rating);
  const type = normalizePoiType(poi.type);
  const name = poi.name || '神秘店铺';

  // 时段严重不匹配：友好提示（第3层硬提示）
  const poiScene = detectPoiScene(poi);
  if (isSceneMismatch(poiScene, currentScene)) {
    const sceneLabel = poiScene === '下午茶/饮品' ? '下午茶' : poiScene;
    return `🌙 抽中「${name}」（${sceneLabel}店），当前是${currentScene}时段，注意营业时间`;
  }

  // 正常抽签文案：按 tier 分档选调性（06-27-draw-algo，让 reason 与手气事件一致）
  // tier 来自 mysteryBoxRecommend 的返回值：explore-head/tail/mid/exploit
  var REASONS_BY_TIER = {
    'explore-head': [   // 手气爆棚（头部高分店开出，稀缺高奖励）
      `🍀 手气爆棚！「${name}」${ratingText}的神仙店`,
      `🎉 运气爆棚：${ratingText}好店就被你抽到了`,
      `✨ 手气真好：这家${type}就在${distanceText}`
    ],
    'explore-tail': [   // 冷门惊喜（长尾冷门店开出，常态惊喜）
      `🎯 冷门惊喜：「${name}」藏得挺深`,
      `🌟 宝藏小店：${distanceText}外有家${type}`,
      `💫 没听过？试试这家「${name}」，可能有惊喜`
    ],
    'explore-mid': [    // 探索中段（既非头部也非长尾）
      `🎁 抽中「${name}」，${ratingText}的好店`,
      `🌟 今日这一签：${distanceText}的${type}`
    ],
    'exploit': [        // 手气不错（利用档主体）
      `✨ 手气不错：${ratingText}的${type}`,
      `🍀 今天运气还行：「${name}」值得一试`,
      `🌈 运气来了：「${name}」，距离${distanceText}`
    ]
  };
  var pool = REASONS_BY_TIER[tier] || REASONS_BY_TIER['exploit'];
  return pool[Math.floor(Math.random() * pool.length)];
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
