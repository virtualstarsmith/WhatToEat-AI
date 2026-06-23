# 场景系统单一事实源 — 技术设计

> 任务：`06-24-scene-system`。配合 `prd.md` 阅读本设计。

## 1. 架构与边界

**新建 `config/scenes.js`** 作为唯一场景事实源。一个场景 = 一个声明对象。所有消费方（index.js、mysteryBox.js）只 import 数据与 `matchesScene`，不再各自持有扁平词表/语气色/文案/冲突矩阵。

```
config/scenes.js   ← 单一事实源（数据 + matchesScene）
   ↑ import
   ├─ pages/index/index.js      （sceneMultiplier 系数留此，匹配调 matchesScene；toneClass/reasonTone 从 scenes 取）
   └─ utils/mysteryBox.js       （timeAwareMultiplier/detectPoiScene/isSceneMismatch 留此，匹配调 matchesScene；conflicts 从 scenes 取）
```

**config 只放数据 + 纯查询函数**，不放带业务系数的乘数逻辑（系数 1.0/0.5、1.2/0.85 留各自页面，本次不动）。

## 2. 数据契约

### `config/scenes.js` 导出

| 导出 | 类型 | 说明 |
|------|------|------|
| `SCENES` | `Scene[]` | 6 场景声明数组（顺序：早餐/午餐/下午茶饮品/晚餐/夜宵/随便吃点）|
| `SCENE_NAMES` | `string[]` | `SCENES.map(s => s.name)`，供 SCENE_OPTIONS 派生 |
| `getScene(name)` | `Scene \| null` | 按名查场景 |
| `matchesScene(sceneName, poi)` | `boolean` | canonical+alias 别名匹配 |

### `Scene` 对象结构

```js
{
  name: '午餐',
  toneClass: 'tone-spicy',        // 原 SCENE_TONE_MAP（UI chip 配色）
  reasonTone: '中午对付一口',      // 原 _generateReason 内 sceneTone（fallback 文案短句）
  match: {                         // canonical → alias[]，别名映射（替代扁平 SCENE_KEYWORDS）
    '面食': ['面','面馆','拉面','刀削面','烩面','板面','热干面'],
    '粉食': ['粉','米粉','米线','酸辣粉','螺蛳粉','肠粉','桂林米粉'],
    '快餐': ['快餐','简餐','便当','盖饭','盒饭','黄焖鸡','麻辣烫','砂锅','炒饭','水饺','饺子','馄饨']
  },
  weights: { d: 0.5, q: 0.5 },     // 权重 profile；首页与盲盒各自引用并覆盖（见 §4）
  conflicts: ['早餐','夜宵']        // 与本场景严重冲突的场景名（原 conflicts 矩阵，补全 6 场景）
}
```

**`随便吃点` 场景**：`match` 为空对象 `{}`（等价于原 `SCENE_KEYWORDS['随便吃点'] = null`，全部等权），`matchesScene` 对空 match 恒返回 true。

### `matchesScene(sceneName, poi)` 实现

```js
function matchesScene(sceneName, poi) {
  const scene = getScene(sceneName);
  if (!scene || !scene.match) return true;       // 随便吃点/未知 → 等权
  const haystack = `${poi.name || ''}${poi.type || ''}${poi.typecode || ''}`;
  const terms = [];
  for (const canon of Object.keys(scene.match)) {
    terms.push(canon, ...scene.match[canon]);    // canonical 本身也参与匹配
  }
  return terms.some((t) => haystack.indexOf(t) >= 0);  // 保留子串匹配（见 §3）
}
module.exports = { matchesScene };  // 与 SCENES/getScene/SCENE_NAMES 同文件导出
```

## 3. 匹配算法决策：canonical+alias，保留子串 indexOf

**为什么不做词边界正则**：餐饮 POI 文本（店名+品类+typecode）不存在「粉」误命中「粉笔」的现实数据，词边界正则收益≈0 却放大回归面与复杂度。**避免过度工程**，保留成熟的子串 indexOf。

**alias 如何根治同义**：06-21 的「面馆≠面食」根因是扁平表里只有「面食」没有「面馆」。canonical+alias 把同义品类显式归组——「面馆/拉面/刀削面」归入「面食」canonical，匹配时全部参与。**新增同义品类 = 加一个 alias，零算法改动**。

## 4. 权重 profile 的归属（重要澄清）

`Scene.weights` 是**默认权重**，但首页(0.5/0.5)与盲盒(0.4/0.4/0.2)有意不同（PRD 已述）。为避免引入新耦合：
- `Scene.weights` 存**首页权重**（首页是主场景）。
- 盲盒在 `mysteryBox.js` 内**硬编码**自己的 `{d:0.4,q:0.4,longtail:0.2}`（现状即如此，calculateWeight 直接写死），不从 scenes 取。
- 这样 `weights` 字段只是「顺手记录首页默认值」，盲盒不消费它，避免 config 反向依赖盲盒语义。**② 已抽的 `scoring.scoreCandidates` 仍由各页面传入自己的 weights，本任务不改变这一契约。**

## 5. 迁移映射表（散落 5 处 → scenes.js）

| 原位置 | 原内容 | 迁入 scenes.js | 消费方改动 |
|--------|--------|----------------|-----------|
| `config/sceneKeywords.js` SCENE_KEYWORDS | 扁平词表 | `match`（升级为 canonical+alias，扩充同义）| 删除该文件，require 改指向 scenes.js |
| `config/sceneKeywords.js` SCENES | 6 场景名列表 | `SCENE_NAMES`（派生）| import 改名 |
| `index.js:10-17` SCENE_TONE_MAP | 语气色 | 各 Scene.toneClass | 删 SCENE_TONE_MAP，SCENE_OPTIONS 用 scenes.toneClass 派生 |
| `index.js:565-572` sceneTone | fallback 文案 | 各 Scene.reasonTone | _generateReason 改读 scene.reasonTone |
| `mysteryBox.js:160-164` conflicts | 冲突矩阵(3场景) | 各 Scene.conflicts（补全6场景）| 删本地 conflicts，isSceneMismatch 读 scene.conflicts |

**匹配算法统一**：`sceneMultiplier`/`timeAwareMultiplier`/`detectPoiScene` 内的 `keywords.some(k=>haystack.indexOf(k))` 全部替换为 `matchesScene(scene, poi)`。

## 6. 逐场景 canonical + alias 清单

基于 06-21 扩充后的词表，归组为 canonical 并补同义 alias。

### 早餐
```
match: {
  '粥品': ['粥','粥铺','砂锅粥','皮蛋瘦肉粥'],
  '面点': ['包子','馒头','花卷','烧麦','生煎','锅贴','煎饺','饭团','烧饼','油条'],
  '粉面': ['粉','肠粉','米粉','米线','馄饨','面','豆浆','豆花','胡辣汤']
}
conflicts: ['夜宵']
weights: { d:0.5, q:0.5 }, toneClass:'tone-value', reasonTone:'早饭得趁热'
```

### 午餐
```
match: {
  '面食': ['面','面馆','拉面','刀削面','烩面','板面','热干面','牛肉面','炸酱面'],
  '粉食': ['粉','米粉','米线','酸辣粉','螺蛳粉','肠粉','桂林米粉','土豆粉'],
  '快餐': ['快餐','简餐','便当','盖饭','盒饭','黄焖鸡','麻辣烫','砂锅','炒饭','水饺','饺子','馄饨','排骨饭']
}
conflicts: ['夜宵']
weights: { d:0.5, q:0.5 }, toneClass:'tone-spicy', reasonTone:'中午对付一口'
```

### 下午茶/饮品
```
match: {
  '茶饮': ['奶茶','茶饮','果茶','水果茶','柠檬茶','柠檬','贡茶','喜茶','奶盖'],
  '咖啡': ['咖啡','cafe','latte','拿铁','美式'],
  '甜品': ['甜品','甜品店','蛋糕','面包','烘焙','冰淇淋','甜点','糕点','西点']
}
conflicts: ['早餐','夜宵']
weights: { d:0.5, q:0.5 }, toneClass:'tone-fresh', reasonTone:'歇会儿'
```

### 晚餐
```
match: {
  '正餐': ['正餐','饭店','酒楼','餐厅','私房菜','小炒','炒菜','家常菜'],
  '火锅烧烤': ['火锅','烧烤','烤鱼','烤肉','串串','串','小龙虾','麻辣'],
  '菜系': ['川菜','湘菜','粤菜','鲁菜','东北菜','西餐','日料','寿司','韩餐','泰餐','海鲜']
}
conflicts: ['早餐']
weights: { d:0.5, q:0.5 }, toneClass:'tone-spicy', reasonTone:'正儿八经吃顿'
```

### 夜宵
```
match: {
  '烧烤串串': ['烧烤','烤','串','串串','烤鱼','烤肉','小龙虾'],
  '小吃': ['炸鸡','鸭脖','毛豆','螺蛳粉','螺蛳','粥','宵夜','夜宵','炒粉','炒面']
}
conflicts: ['早餐','下午茶/饮品']
weights: { d:0.5, q:0.5 }, toneClass:'tone-late', reasonTone:'夜深解个馋'
```

### 随便吃点
```
match: {},   // 空 → 全部等权
conflicts: [],
weights: { d:0.5, q:0.5 }, toneClass:'tone-warm', reasonTone:'随便垫垫'
```

> 注：alias 清单是「在 06-21 基础上补同义」，实现时若发现遗漏可按同义归并原则增补，但不得删减 06-21 已有的覆盖。

## 7. 回归验证脚本设计（用完即删，沿用 06-21 做法）

Node 脚本，require 实际代码，断言：

1. **同义归并（根治）**：「面馆」「拉面」matchesScene('午餐')=true；「米线」「螺蛳粉」matchesScene('午餐')=true 且 '夜宵'=true；「拿铁」matchesScene('下午茶/饮品')=true。
2. **06-21 基线**：午餐时段 `calculateWeight(面馆 150m 4.6) > calculateWeight(阿婆肠粉 800m 4.2)`，且**不依赖** 06-21 手工塞的扁平词（验证从 scenes.js 的 alias 命中）。
3. **不回归·命中集只扩不缩**：用 06-21 词表能命中的 POI，matchesScene 后仍命中（任取原词表词造 POI 验证）。
4. **系数不变**：sceneMultiplier match=1.0/no-match=0.5；timeAwareMultiplier match=1.2/no-match=0.85。
5. **冲突矩阵补全**：6 场景都有 conflicts 字段，isSceneMismatch 对 早餐-夜宵、下午茶-早餐 返回 true。
6. **parseRecommendJson.test.js** 仍 11 项全过（独立跑）。

## 8. 风险与回滚

- **最大风险**：matchesScene 改变命中集 → 影响打分排序。缓解：命中集「只扩不缩」特性 + 回归脚本第 3 条锁定。
- **回滚**：本任务全在一个 commit，`git revert` 即可（无数据迁移、无 storage）。
- **检测Scene（时段→场景）不在本任务范围**：留待 ④。本任务只保证 detectScene 返回的场景名与 scenes.js 的 name 字段字符串一致（已是同一组中文名，天然一致）。
