// 用餐场景单一事实源（single source of truth）。
// 一个场景 = 一个声明对象：匹配规则(canonical+alias) + 语气色(toneClass) + 文案(reasonTone)
// + 权重 profile(weights) + 冲突规则(conflicts)。
// 对应老许方法论：slide5「场景广，不等于规格杂」、slide10「通用语言提供领域化基础设施」。
// 新增/调整一个场景 = 只改这里一个声明对象，零算法改动。
//
// 迁移来源（见 .trellis/tasks/06-24-scene-system/design.md §5）：
//  - match: 取代 config/sceneKeywords.js 的扁平 SCENE_KEYWORDS，升级为 canonical+alias 别名映射。
//  - toneClass: 取代 pages/index/index.js 的 SCENE_TONE_MAP。
//  - reasonTone: 取代 pages/index/index.js _generateReason 内的 sceneTone 表。
//  - conflicts: 取代 utils/mysteryBox.js 的 conflicts 矩阵（原仅覆盖 3 场景，此处补全 6 场景）。
//  - weights: 首页默认权重（盲盒在 mysteryBox.js 自带 0.4/0.4/0.2，不消费本字段，避免反向依赖）。

// 6 场景顺序：早餐/午餐/下午茶饮品/晚餐/夜宵/随便吃点（见 design.md §2）
const SCENES = [
  {
    // 早餐
    name: '早餐',
    toneClass: 'tone-value',
    reasonTone: '早饭得趁热',
    match: {
      '粥品': ['粥', '粥铺', '砂锅粥', '皮蛋瘦肉粥'],
      '面点': ['包子', '馒头', '花卷', '烧麦', '生煎', '锅贴', '煎饺', '饭团', '烧饼', '油条'],
      '粉面': ['粉', '肠粉', '米粉', '米线', '馄饨', '面', '豆浆', '豆花', '胡辣汤', '早餐']
    },
    weights: { d: 0.5, q: 0.5 },
    conflicts: ['夜宵']
  },
  {
    // 午餐
    name: '午餐',
    toneClass: 'tone-spicy',
    reasonTone: '中午对付一口',
    match: {
      '面食': ['面', '面馆', '拉面', '刀削面', '烩面', '板面', '热干面', '牛肉面', '炸酱面'],
      '粉食': ['粉', '米粉', '米线', '酸辣粉', '螺蛳粉', '肠粉', '桂林米粉', '土豆粉'],
      '快餐': ['快餐', '简餐', '便当', '盖饭', '盒饭', '黄焖鸡', '麻辣烫', '砂锅', '炒饭', '水饺', '饺子', '馄饨', '排骨饭']
    },
    weights: { d: 0.5, q: 0.5 },
    conflicts: ['夜宵']
  },
  {
    // 下午茶/饮品
    name: '下午茶/饮品',
    toneClass: 'tone-fresh',
    reasonTone: '歇会儿',
    match: {
      '茶饮': ['奶茶', '茶饮', '果茶', '水果茶', '柠檬茶', '柠檬', '贡茶', '喜茶', '奶盖', '果汁', '轻食'],
      '咖啡': ['咖啡', 'cafe', 'latte', '拿铁', '美式'],
      '甜品': ['甜品', '甜品店', '蛋糕', '面包', '烘焙', '冰淇淋', '甜点', '糕点', '西点']
    },
    weights: { d: 0.5, q: 0.5 },
    conflicts: ['早餐', '夜宵']
  },
  {
    // 晚餐
    name: '晚餐',
    toneClass: 'tone-spicy',
    reasonTone: '正儿八经吃顿',
    match: {
      '正餐': ['正餐', '饭店', '酒楼', '餐厅', '私房菜', '小炒', '炒菜', '家常菜'],
      '火锅烧烤': ['火锅', '烧烤', '烤鱼', '烤肉', '串串', '串', '小龙虾', '麻辣'],
      '菜系': ['川菜', '湘菜', '粤菜', '鲁菜', '东北菜', '西餐', '日料', '寿司', '韩餐', '泰餐', '海鲜']
    },
    weights: { d: 0.5, q: 0.5 },
    conflicts: ['早餐']
  },
  {
    // 夜宵
    name: '夜宵',
    toneClass: 'tone-late',
    reasonTone: '夜深解个馋',
    match: {
      '烧烤串串': ['烧烤', '烤', '串', '串串', '烤鱼', '烤肉', '小龙虾'],
      '小吃': ['炸鸡', '鸭脖', '毛豆', '螺蛳粉', '螺蛳', '粥', '宵夜', '夜宵', '炒粉', '炒面']
    },
    weights: { d: 0.5, q: 0.5 },
    conflicts: ['早餐', '下午茶/饮品']
  },
  {
    // 随便吃点：match 为空 → 全部等权，matchesScene 对空 match 恒返回 true
    name: '随便吃点',
    toneClass: 'tone-warm',
    reasonTone: '随便垫垫',
    match: {},
    weights: { d: 0.5, q: 0.5 },
    conflicts: []
  }
];

// 场景名列表（SCENE_OPTIONS 等派生消费）
const SCENE_NAMES = SCENES.map((s) => s.name);

// 按名查场景，未找到返回 null
function getScene(name) {
  for (const s of SCENES) {
    if (s.name === name) return s;
  }
  return null;
}

// canonical + alias 别名匹配。
// 把 POI 的 name+type+typecode 与该场景所有 canonical + alias 的「并集」做子串命中。
// 保留子串 indexOf（不做词边界正则）：餐饮 POI 文本无「粉」误命中「粉笔」的现实风险，
// 词边界正则收益≈0 却放大回归面与复杂度（避免过度工程，详见 design.md §3）。
// 空 match（随便吃点）或未知场景 → 恒 true（等权，不施加场景乘数）。
function matchesScene(sceneName, poi) {
  const scene = getScene(sceneName);
  const matchKeys = scene.match ? Object.keys(scene.match) : [];
  if (!scene || matchKeys.length === 0) return true; // 空 match(随便吃点)/未知 -> 等权恒 true
  const haystack = `${poi.name || ''}${poi.type || ''}${poi.typecode || ''}`;
  const terms = [];
  for (const canon of Object.keys(scene.match)) {
    terms.push(canon); // canonical 本身也参与匹配
    for (const alias of scene.match[canon]) {
      terms.push(alias);
    }
  }
  return terms.some((t) => haystack.indexOf(t) >= 0);
}

module.exports = {
  SCENES,
  SCENE_NAMES,
  getScene,
  matchesScene
};
