// 手气感 sim 验证脚本（06-27 Step2）
// 验证：AI 情境分注入后，抽签结果是否过度收敛？
// 风险：午餐情境分可能让快餐垄断，手气感丧失。
//
// 用法：node utils/mysteryBox.contextSim.js
//
// 方法：mock 候选池（快餐/正餐/茶饮混合）+ 注入情境分（模拟AI输出），
// 跑 1000 次 mysteryBoxRecommend，统计类型分布 + tier 分布。
// 判据：单一类型占比 <70%（不垄断）、tier 三档都有分布。

const { mysteryBoxRecommend } = require('./mysteryBox.js');

// mock 候选池：30 家，类型分布多元（模拟真实 POI 池）
// poi_id 用类型前缀+编号，便于看分布
function mk(id, name, type, rating, distance, cost) {
  return { poi_id: id, name: name, type: type, rating: rating, distance: distance, cost: cost, location: id + ',1', address: 'x' };
}

const pois = [
  // 茶饮/咖啡（下午茶情境下应+0.2）
  mk('tea1', '喜茶', '冷饮店', 4.2, 100, 25),
  mk('tea2', '霸王茶姬', '冷饮店', 4.0, 150, 22),
  mk('tea3', '星巴克', '咖啡厅', 4.5, 200, 35),
  mk('tea4', '瑞幸', '咖啡厅', 4.3, 120, 18),
  mk('tea5', '古茗', '冷饮店', 3.9, 180, 16),
  // 快餐（下午茶情境下应-0.2~-0.3）
  mk('fast1', '麦当劳', '快餐', 4.1, 80, 30),
  mk('fast2', '肯德基', '快餐', 4.0, 90, 32),
  mk('fast3', '老王快餐', '快餐', 4.4, 110, 20),
  mk('fast4', '沙县小吃', '快餐', 3.8, 130, 15),
  mk('fast5', '塔斯汀', '快餐', 4.3, 100, 22),
  // 正餐（下午茶情境下应-0.2~-0.3）
  mk('meal1', '海底捞', '火锅', 4.8, 500, 120),
  mk('meal2', '外婆家', '中餐厅', 4.5, 400, 60),
  mk('meal3', '西贝莜面', '中餐厅', 4.6, 450, 70),
  mk('meal4', '川菜馆', '川菜', 4.4, 350, 50),
  mk('meal5', '湘菜馆', '湘菜', 4.3, 380, 55)
];

// 模拟 AI 情境分（基于 Step0 实测的下午茶场景逻辑：茶饮+、正餐/快餐-）
const afternoonTeaAdj = {};
pois.forEach(function (p) {
  if (p.type === '冷饮店' || p.type === '咖啡厅') afternoonTeaAdj[p.poi_id] = 0.2;
  else if (p.type === '快餐') afternoonTeaAdj[p.poi_id] = -0.2;
  else afternoonTeaAdj[p.poi_id] = -0.3; // 正餐
});

// 对比：无情境分（纯公式）
function simulate(adjMap, label, trials) {
  const typeCount = {};
  const tierCount = { exploit: 0, 'explore-head': 0, 'explore-mid': 0, 'explore-tail': 0 };
  let valid = 0;
  for (let i = 0; i < trials; i++) {
    const r = mysteryBoxRecommend(pois, [], '下午茶/饮品', adjMap);
    if (!r) continue;
    valid++;
    const poi = pois.find(function (p) { return p.poi_id === r.poi_id; });
    if (poi) {
      const cat = (poi.type === '冷饮店' || poi.type === '咖啡厅') ? '茶饮' : (poi.type === '快餐' ? '快餐' : '正餐');
      typeCount[cat] = (typeCount[cat] || 0) + 1;
    }
    tierCount[r.tier] = (tierCount[r.tier] || 0) + 1;
  }
  console.log('=== ' + label + '（有效' + valid + '/' + trials + '）===');
  console.log('类型分布:');
  Object.keys(typeCount).forEach(function (k) {
    const pct = (typeCount[k] / valid * 100).toFixed(1);
    console.log('  ' + k + ': ' + pct + '% ' + (typeCount[k] / valid > 0.7 ? '⚠️垄断!' : ''));
  });
  console.log('tier分布:');
  Object.keys(tierCount).forEach(function (k) {
    console.log('  ' + k + ': ' + (tierCount[k] / valid * 100).toFixed(1) + '%');
  });
  console.log('');
}

console.log('候选池: 茶饮5家 / 快餐5家 / 正餐5家（共15家）');
console.log('场景: 下午茶/饮品（AI情境: 茶饮+0.2, 快餐-0.2, 正餐-0.3）');
console.log('判据: 单类型<70%不垄断, tier三档都有分布');
console.log('');

simulate(null, '无情境分（纯公式基线）', 1000);
simulate(afternoonTeaAdj, '有情境分（下午茶）', 1000);

console.log('=== 结论判读 ===');
console.log('若茶饮占比明显上升(基线~33% → 情境后>50%) = AI情境生效');
console.log('若茶饮<70% = 手气感保留(未垄断)');
console.log('若tier三档仍有分布 = 探索性保留');
