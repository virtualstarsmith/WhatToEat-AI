# 抽签算法重塑 - 技术设计

> 配套 `prd.md`。聚焦：双峰探索的概率实现、档位界定、长尾加成修正、timer 清理、reason 分档。

## 1. 现状回顾（mysteryBox.js）

```
mysteryBoxRecommend
├─ qualifyFilter（质量门槛：rating≥3.5 或 无评分但≤1500m，且 ≤3000m）
├─ 去重 openedIds
├─ calculateWeight = 0.4·距离 + 0.4·质量 + 0.2·longTailBonus × timeAwareMultiplier
└─ Epsilon-Greedy(ε=0.3)
   ├─ 30%: midBandPick（权重升序取 30%~70% 分位随机选）← 问题：只取中段
   └─ 70%: weightedRandomPick（加权随机）
```

`result` 形状：`{ poi_id, poi, fromExplore: bool }`。`fromExplore` 控制页面是否调 AI。

## 2. Softmax 探索设计（替代双峰硬切）

### 设计依据（文献调研结论）

放弃"双峰分位 + 概率硬切"方案（4 个魔数、分布不连续、纯经验拍脑袋），改用 **Softmax (Boltzmann) 探索**。依据：
- Sutton & Barto 经典教材、NeurIPS "Boltzmann Exploration Done Right"：softmax 比 ε-greedy 探索更智能，天生产出"长尾宽、头部窄"的连续分布。
- 排除的替代方案：Thompson Sampling / UCB / 退火 / Mellowmax 自适应——这些**都依赖奖励反馈闭环或时间轴**，而抽签是无反馈、每次会话独立的一次性场景，无法应用。

**τ 的定参方法（关键，替代凭感觉取值）：**
- 文献铁律：τ 只有相对权重量纲才有意义 → **探索前必须归一化权重到 [0,1]**。
- 退火/自适应在无反馈场景不成立 → τ 只能取**固定值**。
- 固定 τ 的取值不靠拍脑袋 → **用蒙特卡洛网格搜索**：模拟 N 次抽签，统计头部/长尾开出率，选最接近产品目标的 τ。

### 整体概率结构

```
ε=0.15  → 探索档：softmax 选（归一化权重，温度 τ）
1-ε     → 利用档：加权随机 weightedRandomPick（不变）
```

ε 从 0.3 降到 0.15：softmax 探索质量高于纯随机，探索比例可降，主体仍是加权随机（稳）。也贴合行业 ε-greedy 探索 5-15% 的惯例。

### 探索档实现（替换 midBandPick）

```js
// 归一化权重到 [0,1]：让温度 τ 有可比量纲（文献铁律）。
// 候选全相同（min==max）时返回等权，softmax 退化为均匀随机——可接受。
function normalizeWeights(weighted) {
  const ws = weighted.map((c) => c.weight || 0);
  const min = Math.min.apply(null, ws);
  const max = Math.max.apply(null, ws);
  if (max === min) return weighted.map((c) => ({ ...c, normWeight: 0.5 }));
  return weighted.map((c) => ({
    ...c,
    normWeight: ((c.weight || 0) - min) / (max - min)
  }));
}

// Softmax(Boltzmann) 采样：P(i) = exp(normWeight_i / τ) / Σ exp(normWeight_j / τ)
// 返回选中的候选及其在池中的权重排名（供 reason 分档）。
const TAU = 0.1; // 温度，实现时由模拟脚本网格搜索验证后定稿（见 §2 末尾）
function softmaxPick(weighted) {
  const normalized = normalizeWeights(weighted);
  const exps = normalized.map((c) => Math.exp(c.normWeight / TAU));
  const total = exps.reduce((s, e) => s + e, 0);
  let r = Math.random() * total;
  for (let i = 0; i < normalized.length; i++) {
    r -= exps[i];
    if (r <= 0) {
      return { picked: normalized[i], pickedIndex: i };
    }
  }
  return { picked: normalized[normalized.length - 1], pickedIndex: normalized.length - 1 };
}

function explorePick(weighted) {
  // 候选过少：softmax 仍可用（概率自动归一），无需特判；n==1 时唯一候选必中。
  return softmaxPick(weighted);
}
```

### reason 档位判定（事后统计，非算法分支）

softmax 不产出离散 tier。改为**按选中店在池中的权重排名**事后判定档位：

```js
// explorePick 返回 pickedIndex 后，按排名分位定档（排名基于权重降序）
function tierByRank(pickedIndex, n) {
  const sortedRank = ...; // 见下方：需要把 pickedIndex 换算成权重降序排名
  // top 20% → explore-head（手气爆棚）
  // bottom 40% → explore-tail（冷门惊喜）
  // 中间 → explore-mid（中性）
}
```

**实现注意：** `pickedIndex` 是在 `normalized`（原数组顺序）里的下标，不是排序后的排名。需先按权重降序排序，找出 picked 在排序数组中的位置，再算分位。详见 implement。

### result 形状扩展（新增 tier）

```js
// 旧: { poi_id, poi, fromExplore }
// 新: { poi_id, poi, fromExplore, tier }
//   tier: 'exploit' | 'explore-head' | 'explore-tail' | 'explore-mid'
```

### Epsilon-Greedy 改造

```js
function mysteryBoxRecommend(pois, openedIds, currentScene) {
  const epsilon = 0.15;
  // ... qualifyFilter / 去重 / weighted（不变）

  if (Math.random() < epsilon) {
    const { picked, pickedIndex } = explorePick(weighted);
    const tier = tierByRank(picked, pickedIndex, weighted);
    return { poi_id: picked.poi_id, poi: picked.poi, fromExplore: true, tier };
  }
  const picked = weightedRandomPick(weighted);
  return { poi_id: picked.poi_id, poi: picked.poi, fromExplore: false, tier: 'exploit' };
}
```

### τ 的定稿流程（实现第一步，数据驱动）

`TAU` 不在 design 写死，而是在 implement 第一步用模拟脚本确定：

1. 写 `utils/mysteryBox.sim.js`（仅开发期用，不进生产 bundle）：mock 一组真实分布的候选权重（参考实际 POI 池的权重范围），跑 10000 次 mysteryBoxRecommend，统计不同 τ ∈ {0.05, 0.08, 0.1, 0.15, 0.2} 下：
   - 头部(top10%)开出率
   - 长尾(bottom40%)开出率
   - 利用档与探索档的实际占比
2. 输出表格，与产品目标体感对照，选定 τ。
3. 选定后把 TAU 写死进 mysteryBox.js，sim 脚本保留供回归。

**产品目标体感（待数据确认）：** 头部开出率希望落在 ~10-20%（手气爆棚稀缺但真实存在），长尾开出率 ~25-35%（冷门惊喜常态）。具体 τ 由模拟数据反推。


## 3. 长尾加成修正（评审问题4）

现状：
```js
function longTailBonus(poi) {
  const isChain = CHAIN_KEYWORDS.some(...);
  return isChain ? 0.2 : 1.0;   // 非连锁一律 1.0
}
```
问题：无评分苍蝇馆 = 非连锁 = 1.0 满格，反超 4.5 分连锁。

修正：长尾加成分级，与质量信号挂钩：
```js
function longTailBonus(poi) {
  const isChain = CHAIN_KEYWORDS.some((k) => (poi.name || '').indexOf(k) >= 0);
  if (isChain) return 0.2;
  // 非连锁：有评分证据才给满格惊喜加成；无评分降权，避免开出无信息垃圾店
  return poi.rating ? 1.0 : 0.5;
}
```
- 非连锁+有评分 → 1.0（真·特色小店，鼓励）
- 非连锁+无评分 → 0.5（信息不足，适度降权，但仍高于连锁0.2）
- 连锁 → 0.2（降权，保留盲盒惊喜性）

这样无评分店综合权重 = 0.4·距离 + 0.4·0.3 + 0.2·0.5 = 0.4·距离 + 0.22，明显低于有评分店，不再反超。

## 4. setTimeout 清理（评审问题3）

### 现状
```js
// onOpenMysteryBox 内
setTimeout(() => { this._revealMysteryBox(result, aiReasonPromise); }, 2000);
// timer 未保存，无法清理
```

### 修正
1. data 新增 `mysteryBox._openTimer`（或实例属性 `this._openTimer`）保存 timer id。
2. `onHide` / `onUnload` 时清理：
   ```js
   onHide() {
     this._clearOpenTimer();
   },
   onUnload() {
     this._clearOpenTimer();
   },
   _clearOpenTimer() {
     if (this._openTimer) {
       clearTimeout(this._openTimer);
       this._openTimer = null;
     }
   }
   ```
3. `onOpenMysteryBox` 设 timer 前先清旧的（防重入），保存 id：
   ```js
   this._clearOpenTimer();
   this._openTimer = setTimeout(() => {
     this._openTimer = null;
     this._revealMysteryBox(result, aiReasonPromise);
   }, 2000);
   ```
4. `_resetMysteryBox` 也清 timer（重置时不应有遗留揭晓）。

**用实例属性 `this._openTimer` 而非 data：** timer id 不参与渲染，放实例属性避免 setData 开销与 data 污染（与现有 `this._poisConsumedAt` 同模式）。

### onHide 揭晓的处理
onHide 清 timer 后，若 opening 中途切走，回来时 status 仍是 'opening'（卡住）。处理：onShow 时若发现 status==='opening'，重置为 'idle'（视为本次抽签作废，用户需重新点）。这比"后台偷偷揭晓"更可控。

## 5. reason 文案分档（generateMysteryReason）

现状：7 条随机混选，不区分档位。
改造：接收 `tier` 参数，按档位选调性。

```js
function generateMysteryReason(poi, currentScene, tier) {
  // ... 不匹配硬提示逻辑不变（优先级最高）

  const REASONS_BY_TIER = {
    'explore-head': [   // 手气爆棚（头部开出，~τ 决定的概率）
      `🍀 手气爆棚！「${name}」${ratingText}的神仙店`,
      `🎉 运气爆棚：${ratingText}好店就被你抽到了`,
      `✨ 手气真好：这家${type}就在${distanceText}`
    ],
    'explore-tail': [   // 冷门惊喜（长尾开出）
      `🎯 冷门惊喜：「${name}」藏得挺深`,
      `🌟 宝藏小店：${distanceText}外有家${type}`,
      `💫 没听过？试试这家「${name}」，可能有惊喜`
    ],
    'explore-mid': [    // 探索中段（既非头部也非长尾）
      `✨ 抽中「${name}」，${ratingText}的好店`,
      `🌟 今日这一签：${distanceText}的${type}`
    ],
    'exploit': [        // 手气不错（利用档，主体）
      `✨ 手气不错：${ratingText}的${type}`,
      `🍀 今天运气还行：「${name}」值得一试`,
      `🌟 这家${type}评分${ratingText}，可以`
    ]
  };
  const pool = REASONS_BY_TIER[tier] || REASONS_BY_TIER['exploit'];
  return pool[Math.floor(Math.random() * pool.length)];
}
```

**调用方改动：**
- `_revealMysteryBox` 调 `generateMysteryReason(poi, scene, result.tier)`。
- AI 理由仍只对探索档发起（`fromExplore`），利用档用本地模板。

**注意：** 揭晓徽标"🎉 看看你抽到了啥"是固定 UI，不随 tier 变（保持简洁）；reason 才是分档调性的载体。

## 6. AI 调用策略调整

现状：`fromExplore` → 调 AI。
新策略（softmax 方案下 fromExplore 即探索档，无需排除 fallback）：
```js
// onOpenMysteryBox 内
let aiReasonPromise = null;
if (result.fromExplore) {
  aiReasonPromise = callMysteryAIReason(result.poi, this.data.scene);
}
```
`callMysteryAIReason` 的 system prompt 可加 tier hint（头部/长尾），让 AI 生成的理由也贴合档位。但这是增强，非必须——本地模板已分档，AI 失败回退本地仍成立。**本期 prompt 不改 tier hint**，保持改动聚焦（本地 reason 分档已足够区分调性）。

## 7. 边界

| 场景 | 处理 |
|---|---|
| 候选全相同权重 | normalizeWeights 返回等权，softmax 退化为均匀随机（可接受） |
| 候选 == 1 | softmax 必中唯一候选，tier 由 tierByRank 判定为 explore-mid |
| NaN/负权重 | calculateWeight 不产生负值（各项非负），softmax 安全 |
| opening 中切走 | onHide 清 timer；onShow 发现 status==='opening' 重置为 idle |
| 场景不匹配 | 硬提示优先（reason 分档不影响 isMismatch 逻辑） |

## 8. 验证策略

- **τ 网格搜索（implement 第一步）**：mysteryBox.sim.js 跑 10000 次，统计各 τ 的头部/长尾/中段开出率，选定 τ。
- **分布回归**：选定 τ 后，再跑 10000 次确认 tier 分布符合产品目标体感。
- **长尾加成**：mock 无评分非连锁店 + 高分连锁店，验证前者权重不再反超。
- **真机**：连抽 10 次，肉眼确认头部/长尾/利用三种结果都出现。

