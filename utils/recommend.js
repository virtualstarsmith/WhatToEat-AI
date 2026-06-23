// 推荐域共享工具（detectScene/format*/pad2），消除首页与盲盒页的双份复制。
// 见 06-24-recommend-module。对应老许方法论：两个页面是同一产品规格的两种 UI 外壳，
// 共享基础设施不应各自重写。

// 时段 → 场景名（迁移自 index.js / mystery.js，二者逐字相同）。
function detectScene() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) return '早餐';
  if (hour >= 10 && hour < 14) return '午餐';
  if (hour >= 14 && hour < 17) return '下午茶/饮品';
  if (hour >= 17 && hour < 21) return '晚餐';
  return '夜宵';
}

// 距离格式化（以 index 版为准：' km'/' m'）。
function formatDistance(d) {
  if (d == null) return '';
  return d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
}

// 评分格式化（'无评分' 兜底）。
function formatRating(r) {
  return r ? r.toFixed(1) : '无评分';
}

// 时间补零（统一命名 pad2，废弃 padHour/pad2 双名）。
function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

module.exports = { detectScene, formatDistance, formatRating, pad2 };
