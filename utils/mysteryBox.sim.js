// 抽签算法 τ 网格搜索脚本（开发期工具，不进生产 bundle）。
// 目的：数据驱动选定 softmax 温度 τ，不凭感觉。
//
// 用法：node utils/mysteryBox.sim.js
//
// 背景：探索档改用 softmax（P(i)=exp(w_i/τ)/Σexp(w_j/τ)）。τ 的取值必须相对
// 归一化后的权重量纲，且抽签无反馈闭环，无法用退火/自适应，只能固定 τ。
// 故用蒙特卡洛模拟统计不同 τ 的头部/长尾开出率，按产品目标体感选定。
//
// 产品目标体感：头部(top10%)开出率 ~10-20%（手气爆棚稀缺但真实存在），
// 长尾(bottom40%)开出率 ~25-35%（冷门惊喜常态）。

// ===== mock 候选权重（模拟真实 POI 池分布）=====
// calculateWeight = 0.4·distanceScore + 0.4·qualityScore + 0.2·longTailBonus
// distanceScore = exp(-distance/800)：500m→0.54, 800m→0.37, 1500m→0.15, 2500m→0.04
// qualityScore = rating/5：4.5分→0.9, 4.0→0.8, 3.5→0.7, 无评分→0.3
// longTailBonus：连锁0.2 / 非连锁有评分1.0 / 非连锁无评分0.5
//
// 构造 30 个候选，覆盖典型权重范围 0.15~0.75（粗算）：
//   - 高分近店(头部)：4.5分+500m → 0.4·0.54+0.4·0.9+0.2·1.0 ≈ 0.776
//   - 高分中距：4.5分+1000m → 0.4·0.29+0.36+0.2 ≈ 0.676
//   - 中分近店：3.8分+400m → 0.4·0.61+0.4·0.76+0.2 ≈ 0.708
//   - 中庸店：3.5分+1200m → 0.4·0.22+0.28+0.2 ≈ 0.568
//   - 远店：3.5分+2000m → 0.4·0.08+0.28+0.2 ≈ 0.512
//   - 无评分近店：null+600m → 0.4·0.47+0.12+0.1 ≈ 0.41
//   - 无评分远店：null+2200m → 0.4·0.06+0.12+0.1 ≈ 0.256
// 手工构造一组有梯度的权重，模拟"近好店高、远烂店低"的真实分布。
const MOCK_WEIGHTS = [
  // 头部（top，~0.75）
  0.776, 0.76, 0.74, 0.72,
  // 偏上（~0.65）
  0.708, 0.70, 0.68, 0.676, 0.65, 0.63,
  // 中段（~0.55）
  0.60, 0.58, 0.568, 0.55, 0.53, 0.51,
  // 偏下（~0.45）
  0.49, 0.47, 0.45, 0.43, 0.41,
  // 长尾（低，~0.3）
  0.38, 0.35, 0.33, 0.30, 0.28, 0.256, 0.24, 0.22, 0.20, 0.18
];
// n=30，top10% = top3（权重最高的3个），bottom40% = 最低12个

const N = MOCK_WEIGHTS.length;
const HEAD_COUNT = Math.floor(N * 0.1);      // top10% = 3个
const TAIL_COUNT = Math.ceil(N * 0.4);       // bottom40% = 12个

// 归一化到 [0,1]
function normalize(ws) {
  const min = Math.min.apply(null, ws);
  const max = Math.max.apply(null, ws);
  if (max === min) return ws.map(() => 0.5);
  return ws.map((w) => (w - min) / (max - min));
}

// softmax 采样，返回选中的原始下标
function softmaxPick(normWs, tau) {
  const exps = normWs.map((w) => Math.exp(w / tau));
  const total = exps.reduce((s, e) => s + e, 0);
  let r = Math.random() * total;
  for (let i = 0; i < normWs.length; i++) {
    r -= exps[i];
    if (r <= 0) return i;
  }
  return normWs.length - 1;
}

// 跑 TRIALS 次，统计选出下标落在头部/中段/长尾的比例
function simulate(tau, trials) {
  const normWs = normalize(MOCK_WEIGHTS);
  // 按原始权重降序排名，找出 top HEAD_COUNT 的下标集合、bottom TAIL_COUNT 的下标集合
  const indexed = MOCK_WEIGHTS.map((w, i) => ({ w, i }));
  indexed.sort((a, b) => b.w - a.w); // 降序
  const headIdx = new Set(indexed.slice(0, HEAD_COUNT).map((x) => x.i));
  const tailIdx = new Set(indexed.slice(N - TAIL_COUNT).map((x) => x.i));

  let headHits = 0, tailHits = 0, midHits = 0;
  for (let t = 0; t < trials; t++) {
    const picked = softmaxPick(normWs, tau);
    if (headIdx.has(picked)) headHits++;
    else if (tailIdx.has(picked)) tailHits++;
    else midHits++;
  }
  return {
    tau,
    head: (headHits / trials * 100).toFixed(1) + '%',
    mid: (midHits / trials * 100).toFixed(1) + '%',
    tail: (tailHits / trials * 100).toFixed(1) + '%'
  };
}

// ===== 主：网格搜索 =====
const TAUS = [0.05, 0.08, 0.1, 0.15, 0.2, 0.3];
const TRIALS = 10000;

console.log(`候选数 N=${N}，头部(top${(HEAD_COUNT/N*100).toFixed(0)}%=${HEAD_COUNT}个)，长尾(bottom${(TAIL_COUNT/N*100).toFixed(0)}%=${TAIL_COUNT}个)`);
console.log('权重范围:', Math.min.apply(null, MOCK_WEIGHTS).toFixed(3), '~', Math.max.apply(null, MOCK_WEIGHTS).toFixed(3));
console.log('');
console.log('tau  | 头部(top10%) | 中段 | 长尾(bottom40%)');
console.log('-----|-------------|------|----------------');
const results = TAUS.map((tau) => simulate(tau, TRIALS));
results.forEach((r) => {
  console.log(`${r.tau.toString().padEnd(4)} |  ${r.head.padStart(10)} | ${r.mid.padStart(4)} | ${r.tail.padStart(14)}`);
});
console.log('');
console.log('产品目标体感：头部 ~10-20%、长尾 ~25-35%');
console.log('（注意：这是探索档内部的分布；整体还要乘以 ε=0.15 才是实际抽签占比）');
