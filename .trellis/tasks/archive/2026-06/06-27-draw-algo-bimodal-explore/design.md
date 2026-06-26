# 抽签算法重塑 - 技术设计

> 配套 `prd.md`。聚焦：降幂加权随机探索（p=0.5）、tier 判定、长尾加成修正、timer 清理、reason 分档。
>
> **方案演进：** 初版设计为双峰硬切 → 调研后改 softmax → sim 验证 softmax 在本场景头部通吃失败 → 最终选定降幂加权随机 p=0.5（数据驱动）。教训：方案选型必须先用真实分布验证。

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

## 2. 降幂加权随机探索设计（替代 midBandPick）

### 方案选型（数据驱动，已用模拟验证）

候选方案均用 `utils/mysteryBox.sim.js` 跑 10000 次蒙特卡洛验证（候选 N=31，权重范围 0.18~0.78，模拟真实 POI 池梯度）：

| 方案 | 头部(top10%) | 中段 | 长尾(bottom40%) | 结论 |
|---|---|---|---|---|
| softmax τ=0.1 | 57.0% | 42.7% | 0.4% | ❌ 头部通吃，长尾消失 |
| softmax τ=0.3 | 26.8% | 62.3% | 10.9% | ❌ 仍严重偏头部 |
| **加权随机 p=0.5（√weight）** | **12.2%** | **54.7%** | **33.1%** | ✅ **命中目标，选定** |
| 加权随机 p=1.0（现状） | 15.3% | 58.5% | 26.3% | 已达标，长尾略少 |
| 加权随机 p=0.2 | 10.9% | 50.5% | 38.6% | 长尾偏重，质量下降 |

**选定 p=0.5（开根号）的理由：**
1. **数据命中目标**：头部 12%（手气爆棚稀缺真实）、长尾 33%（冷门惊喜常态），正中产品体感。
2. **改动极小**：现有 `weightedRandomPick` 加一个 `Math.pow(weight, 0.5)`。
3. **sqrt 压缩权重差距**（不开指数放大），让长尾有合理概率但保留头部优势——温和探索，比 softmax 友好，比双峰硬切自然。
4. **无 τ、无归一化、无双池**——最简方案。

**为什么不选 softmax（设计教训）：** softmax 用 exp 指数放大权重差距，而我们的权重分布（头部 0.78 vs 长尾 0.18，归一化后 1.0 vs 0.0）天然有大梯度，exp 放大后 `exp(1/0.2)=148` 倍差距，导致头部通吃、长尾趋零。理论优雅但在我们的权重分布下结构性失败。**教训：方案选型必须先用真实分布数据验证，不能只看理论。**

### 整体概率结构

```
ε=0.15 探索档 → 降幂加权随机 P∝√weight（全池，p=0.5，更平权，鼓励长尾）
1-ε    利用档 → 加权随机 P∝weight（全池，p=1.0，现状不变，偏头部）
```

探索档与利用档的**唯一差别是 p 值**：探索档 p=0.5（压缩差距，长尾更易出），利用档 p=1.0（保留差距，偏头部）。语义清晰、实现极简。

ε 从 0.3 降到 0.15：探索档已用降幂加权（质量高于纯随机），探索比例可降，主体仍是利用档（稳）。也贴合行业 ε-greedy 探索 5-15% 的惯例。

### 探索档实现（替换 midBandPick）

```js
// 降幂加权随机：P(i) ∝ weight_i^p。p<1 压缩差距（鼓励长尾），p=1 即原加权随机。
// 复用 weightedRandomPick，传入幂次参数。
function weightedPowPick(candidates, p) {
  const weights = candidates.map((c) => Math.pow(c.weight || 0, p));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  let random = Math.random() * totalWeight;
  for (let i = 0; i < candidates.length; i++) {
    random -= weights[i];
    if (random <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

const EXPLORE_POWER = 0.5; // √weight，由 sim 网格搜索验证（见 §2 末尾）

function explorePick(weighted) {
  return weightedPowPick(weighted, EXPLORE_POWER);
}
```

> **实现选择：** `weightedPowPick(candidates, p)` 是 `weightedRandomPick` 的参数化版（p=1 退化为原逻辑）。可让 `weightedRandomPick` 直接接收可选 p 参数（默认 1.0），避免两份近似函数。见 implement。

### reason 档位判定（事后统计）

降幂加权不产出离散 tier。按选中店在池中的**权重排名**事后判定档位：

```js
// picked: 选中的候选；weighted: 全部候选
// 返回 tier：'explore-head' | 'explore-mid' | 'explore-tail'
function tierByRank(picked, weighted) {
  const sorted = weighted.slice().sort((a, b) => (b.weight || 0) - (a.weight || 0)); // 降序
  const n = sorted.length;
  const rank = sorted.findIndex((c) => c.poi_id === picked.poi_id); // 0=最高
  if (rank < Math.max(1, Math.floor(n * 0.2))) return 'explore-head';   // top 20% → 手气爆棚
  if (rank >= Math.floor(n * 0.6)) return 'explore-tail';                // bottom 40% → 冷门惊喜
  return 'explore-mid';                                                  // 中间
}
```

**头部阈值取 top20%（而非 top10%）：** reason 分档是为文案调性服务的，不必和 sim 统计的"top10%开出率"严格对齐。top20% 让"手气爆棚"文案触发频率稍高（避免太罕见用户感知不到），是 UX 权衡，不影响实际分布。

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
    const picked = explorePick(weighted);
    const tier = tierByRank(picked, weighted);
    return { poi_id: picked.poi_id, poi: picked.poi, fromExplore: true, tier };
  }
  const picked = weightedRandomPick(weighted);
  return { poi_id: picked.poi_id, poi: picked.poi, fromExplore: false, tier: 'exploit' };
}
```

### EXPLORE_POWER 的定稿依据（数据已在 sim 脚本固化）

`EXPLORE_POWER=0.5` 由 `utils/mysteryBox.sim.js` 网格搜索验证（p ∈ {1.0, 0.7, 0.5, 0.3, 0.2, 0.1}）。sim 脚本保留供回归。选定 p=0.5 的产品目标：头部开出率 ~10-20%、长尾开出率 ~25-35%。


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

