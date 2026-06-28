# 手气抽签 AI情境分 - 技术设计

> 配套 `prd.md`。聚焦：aiContext.js 契约、AI prompt、候选池精简、缓存、手气感验证、兜底、reason 改造。

## 1. 架构概览

```
场景切换/进页面
  └→ scoreSceneContext(pois, scene)  [utils/aiContext.js]
        ├→ 精简候选池（topN）送 AI
        ├→ AI 输出 { adjustments: {poi_id: 分值}, reason }
        └→ 缓存（key = 场景+候选池指纹）
  └→ 缓存结果存入页面 data（contextAdjustments / contextReason）

抽签动作
  └→ mysteryBoxRecommend(pois, openedIds, scene, contextAdjustments)
        ├→ calculateWeight(poi, scene) = base + (contextAdjustments[poi_id] || 0)
        └→ E&E + 降幂加权随机（不变）
  └→ 揭晓 reason = contextReason + tier 文案
```

## 2. AI 情境引擎 `utils/aiContext.js`

### 契约

```js
async function scoreSceneContext(pois, scene, opts?) → Promise<Result|null>

Result = {
  adjustments: { [poi_id: string]: number },  // -0.3 ~ +0.3
  reason: string                               // 场景级理由，如"午餐求快，偏好快餐"
}
```

- `pois`：getPoi 返回的标准化 POI 数组（完整池，函数内部精简）
- `opts.timeout`：AI 超时（默认 8s，失败返回 null）
- 返回 null = AI 失败，调用方回退纯公式（无情境分）

### 缓存

```js
// key = scene + 候选池指纹（poi_id 排序后拼接的 hash）
// 同场景 + 同候选池 → 命中缓存，不重复调 AI
const cache = new Map(); // module 级缓存（页面切换间保持）
function cacheKey(pois, scene) {
  const ids = pois.map(p => p.poi_id || makePoiId(p)).sort().join(',');
  return scene + '|' + simpleHash(ids);
}
```

**为什么用 poi_id 指纹而非 scene 单独缓存：** 候选池变了（如换位置），同场景的情境分也应重算（新店没有分）。指纹包含池内容，保证"同场景同池"才命中。

### 候选池精简（关键：控制 token）

**问题：** 候选池可能 30-50 家，全送 AI 会导致 token 爆炸 + AI 评分疲劳（后段敷衍）。

**策略：预排序取 topN。** 送 AI 前先按 base score 排序，取 **top 15** 家：
- 这 15 家是"公式认为还行的"，AI 在其中注入情境判断
- 落选的（base 分太低）不送 AI，情境分给 0（纯公式决定）
- 这样 AI 只评 15 家，token 可控，且评的是"值得评的"

**送 AI 的字段（精简）：** poi_id / name / type / distance(米) / rating / cost。不含地址/坐标等冗余字段。

### AI prompt 设计

**system：**
```
你是一个懂吃的本地向导。根据当前用餐场景，为每家候选店评估"情境适配度"。
- 正分(-0.3~+0.3)：适合本场景（如午餐场景给快餐+，因求快）
- 负分：不适合（如午餐给火锅-，因太慢太重）
- 0：中性
原则：分值反映"距离和评分表达不了的情境判断"，不要因距离远/评分低就给负分（那些公式已处理）。
必须严格返回 JSON：{"reason":"本场景选店倾向一句话","adjustments":{"poi_id":分值,...}}
必须为输入的每个 poi_id 都打分。
```

**user：**
```json
{
  "scene": "午餐",
  "candidates": [
    {"poi_id":"xxx","name":"老王快餐","type":"快餐","distance":300,"rating":4.5,"cost":20},
    ...
  ]
}
```

**输出解析：** 复用 `parseRecommendJson`（4层容错），取 adjustments 对象。校验：
- 每个 poi_id 必须在输入候选里（防 AI 编造）
- 分值 clamp 到 [-0.3, +0.3]（防极端值破坏随机）
- 缺失的 poi_id 分值补 0

## 3. mysteryBox.js 改造

### calculateWeight 加情境分

```js
// 旧：base * timeAwareMultiplier
// 新：(base + contextAdjust) * timeAwareMultiplier
function calculateWeight(poi, currentScene, contextAdjust) {
  const base = 0.4 * distanceScore(poi.distance)
             + 0.4 * qualityScore(poi.rating)
             + 0.2 * longTailBonus(poi);
  const adj = contextAdjust || 0;
  return (base + adj) * timeAwareMultiplier(poi, currentScene);
}
```

**contextAdjust 加在 base 上、timeAware 乘在外层**（情境是基础属性调整，时段乘数仍整体施加）。

### mysteryBoxRecommend 加 contextAdjustments 入参

```js
function mysteryBoxRecommend(pois, openedIds, currentScene, contextAdjustments) {
  // contextAdjustments: { [poi_id]: number } 或 null/undefined（回退纯公式）
  const adjMap = contextAdjustments || {};
  const weighted = candidates.map(function (c) {
    return Object.assign({}, c, {
      weight: calculateWeight(c.poi, currentScene, adjMap[c.poi_id] || 0)
    });
  });
  // 后续 E&E + 降幂加权随机不变
}
```

向后兼容：contextAdjustments 不传时 adjMap 为空，等于纯公式（兜底场景）。

## 4. mystery.js 场景切换预热

### 进页面/切场景时调 AI 情境

```js
async _refreshContextAdjustments() {
  if (!this.data.pois || this.data.pois.length === 0) return;
  this.setData({ contextLoading: true });
  try {
    const result = await scoreSceneContext(this.data.pois, this.data.scene);
    this.setData({
      contextAdjustments: result ? result.adjustments : null,
      contextReason: result ? result.reason : '',
      contextLoading: false
    });
  } catch (e) {
    this.setData({ contextAdjustments: null, contextReason: '', contextLoading: false });
  }
}
```

**触发点：**
- onShow（首次/从其他 tab 切回，pois 变化时）
- onSelectScene（切场景）调 _refreshContextAdjustments
- 位置变化（pois 更新）后调

**抽签时：** `mysteryBoxRecommend(pois, openedIds, scene, this.data.contextAdjustments)`

### loading 反馈
- contextLoading=true 时，抽签按钮可显示副文案"AI 正在揣摩口味..."（但不阻塞抽签——情境没就绪就用纯公式抽，保证可用）
- **抽签动作永不阻塞**：情境分是"锦上添花"，没就绪也能抽（纯公式）

## 5. reason 改造（从单店编理由 → 场景理由）

### 现状
- callMysteryAIReason：选好店后，单独调 AI 给这家店编理由（只看单店 + 场景）
- 每次抽签（探索档）都调一次 AI

### 改造
- **主理由**：用 contextReason（场景级，AI 情境引擎已产出，如"午餐求快，偏好快餐"）+ tier 文案（手气爆棚/冷门惊喜）拼接
- **弱化 callMysteryAIReason**：不再每次抽签调 AI 编单店理由。理由前置到情境引擎（一次场景切换产出一个场景理由，多次抽签复用）
- **节省 AI 调用**：从"每次抽签调一次"降到"每次场景切换调一次"

```js
// 揭晓理由 = 场景理由 + 档位文案
function buildRevealReason(contextReason, tier, poi) {
  // 如 "午餐求快，偏好快餐 · 手气爆棚"
  // contextReason 为空时（AI失败兜底）只用 tier 文案
}
```

generateMysteryReason（本地模板）保留作为 contextReason 也为空时的最后兜底。

## 6. 手气感验证（关键，防 AI 让结果收敛）

**风险：** AI 情境分可能让某类店（如午餐的快餐）整体被抬升，导致连抽结果趋同（都是快餐），手气感丧失。

**验证方法（sim）：**
- mock 候选池（含快餐/正餐/火锅混合）
- 注入午餐情境分（快餐+、火锅-）
- 跑 1000 次 mysteryBoxRecommend，统计：
  - 类型分布（快餐占比是否过高？应仍多元）
  - tier 分布（head/mid/tail 比例，不应被 AI 压扁）
- 若快餐占比 >70% → 情境分太强，需降低分值范围（如 -0.2~+0.2）或加权稀释

**防御机制：**
- 情境分范围限制 ±0.3（相对 base 0.3~0.9，影响显著但不压倒）
- 降幂加权随机（p=0.5）仍压缩差距，保留长尾机会
- 若 sim 显示过度收敛，design 迭代调整分值范围

## 7. 边界与失败处理

| 场景 | 处理 |
|---|---|
| AI 超时/失败 | scoreSceneContext 返回 null，contextAdjustments=null，抽签走纯公式 |
| AI 返回缺 poi_id | 缺失项补 0（adjustments map 合并默认 0） |
| AI 返回极端分值 | clamp 到 [-0.3, +0.3] |
| AI 编造不存在的 poi_id | 校验时丢弃（只保留输入候选内的） |
| 候选池 < 3 | 不调 AI（太少无需情境分），直接纯公式 |
| pois 为空 | 不调 AI |
| 抽签时 contextLoading 未完成 | 用 null（纯公式）抽签，保证可用不阻塞 |

## 8. 实现顺序（implement.md 依据）

1. aiContext.js（scoreSceneContext + 缓存 + prompt + 解析校验）— 核心模块
2. sim 验证 prompt 稳定性 + 手气感分布（Step 0 式验证）
3. mysteryBox.js（calculateWeight 加 adj + mysteryBoxRecommend 加参数）
4. mystery.js（场景切换预热 + 抽签传参 + reason 改造）
5. 端到端验证 + 残留检查

## 9. 不做的事

- ❌ 不改 scoring.js（base 评分逻辑不变，情境分是叠加层）
- ❌ 不改 E&E / 降幂加权随机骨架（手气感来源不变）
- ❌ 不做实时情境（天气/排队）——本期只做场景级情境分，未来扩展
- ❌ callMysteryAIReason 不完全删除（保留作为极端兜底，但默认流程不调）
