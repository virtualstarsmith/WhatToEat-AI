# 抽签算法重塑 - 执行计划

> 配套 `design.md`。方案演进后定为**降幂加权随机 p=0.5**（sim 验证 softmax 失败，见 design §2）。

## 执行清单

### Step 0: 网格搜索定探索参数 ✅ 已完成

`utils/mysteryBox.sim.js` 已跑出数据，结论：
- softmax 各 τ 均头部通吃（57-81%），长尾趋零（0-11%）→ **放弃 softmax**
- 降幂加权随机 p=0.5：头部 12.2% / 中段 54.7% / 长尾 33.1% → **命中产品目标，选定**

**选定参数：** `EXPLORE_POWER = 0.5`（探索档）、利用档沿用 `weightedRandomPick`（p=1.0）、`ε = 0.15`。

**文件：** `utils/mysteryBox.sim.js`（已建，开发期保留供回归）

---

### Step 1: mysteryBox.js 算法改造

**改动点（按 design §2、§3、§5）：**

1. `weightedRandomPick` 扩展为接收可选幂次参数 `p`（默认 1.0，向后兼容）；或新增 `weightedPowPick(candidates, p)`。利用档调 `weightedRandomPick(weighted)`（p=1），探索档调 `weightedPowPick(weighted, 0.5)`。
2. 新增 `tierByRank(picked, weighted)`（design §2 reason 档位判定）
3. 删除 `midBandPick`（被降幂加权替代）
4. `mysteryBoxRecommend`：ε 改 0.15；探索分支用 `explorePick`（=weightedPowPick p=0.5）+ tierByRank；result 增加 tier 字段
5. 新增常量 `EXPLORE_POWER = 0.5`，注释引用 sim 结论
6. `longTailBonus` 修正：无评分非连锁店 0.5（不再满格 1.0）（design §3）
7. `generateMysteryReason` 增加 tier 参数，按档位选文案（design §5）

**文件：** `utils/mysteryBox.js`

**验证：**
- node require 测试
- 跑 sim 脚本确认 tier 分布稳定（设计目标：探索档内 head~12%/tail~33%）
- mock 无评分非连锁店 + 高分连锁店，验证长尾加成修正后前者权重不再反超

---

### Step 2: mystery.js 页面适配

**改动点（按 design §4、§6）：**

1. setTimeout 生命周期管理：
   - 实例属性 `this._openTimer` 保存 timer id
   - 新增 `_clearOpenTimer()`、`onHide()`、`onUnload()`
   - `onShow` 开头：若 status==='opening' 重置为 idle（design §4 onHide 揭晓处理）
   - `_resetMysteryBox` 调 _clearOpenTimer
   - `onOpenMysteryBox` 设 timer 前先清旧、保存 id、回调内清空 id
2. `_revealMysteryBox`：调 `generateMysteryReason(poi, scene, result.tier)`
3. AI 调用：`if (result.fromExplore)` 触发（无需排除 fallback）

**文件：** `pages/mystery/mystery.js`

**验证：** 语法检查；真机验证切 tab 不卡 opening。

---

### Step 3: 残留检查与回归

- grep 确认 `midBandPick` 无残留引用
- grep 确认无 `softmaxPick / normalizeWeights / TAU` 残留（softmax 方案已废）
- grep 确认无 `explore-fallback` 残留（已改 explore-mid）
- 确认 `fromExplore` 仍被页面消费（AI 调用判断）
- 跑 sim 脚本确认选定参数分布稳定

---

## 回滚点

- Step 1 改动可整体 revert（mysteryBox.js 是自包含算法模块）
- Step 2 独立于 Step 1（页面层），可单独 revert
- Step 0 sim 脚本独立，不影响生产

## 完成标准

- [ ] EXPLORE_POWER=0.5 由 sim 数据支撑（已完成）
- [ ] 降幂加权探索替代 midBandPick，tier 分布符合产品目标
- [ ] 头部(top10%)能真实开出，长尾(bottom40%)能真实开出
- [ ] 无评分店不再因长尾加成反超高分店
- [ ] setTimeout 在 onHide/onUnload 被清理，切 tab 不卡 opening
- [ ] reason 文案按 tier 分档（head/tail/mid/exploit）
- [ ] 无 midBandPick / softmax / TAU / explore-fallback 残留
- [ ] 场景不匹配硬提示、池子耗尽、去重等现有逻辑不受影响
