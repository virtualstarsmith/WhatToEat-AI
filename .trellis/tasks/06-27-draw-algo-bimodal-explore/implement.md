# 抽签算法重塑 - 执行计划

> 配套 `design.md`。**Step 0 是数据驱动的 τ 定参，必须在改算法代码之前完成。**

## 执行清单

### Step 0: 网格搜索定 τ（数据驱动，先于一切代码改动）

**目的：** 不凭感觉定 τ，用模拟数据反推。

**做法：**
1. 写 `utils/mysteryBox.sim.js`（开发期脚本，可独立 node 运行）：
   - mock 一组候选 POI，权重分布参考真实池子（构造 ~30 个候选，权重覆盖 0.3~0.9 的典型范围，含无评分低权重、高分高权重、中庸店）
   - 实现一个临时的 softmaxPick + normalizeWeights（与 design §2 一致）
   - 对 τ ∈ {0.05, 0.08, 0.1, 0.15, 0.2}，各跑 10000 次采样
   - 统计：头部(top10%)开出率、长尾(bottom40%)开出率、中段开出率
2. 输出对比表，按产品目标体感（头部 ~10-20%、长尾 ~25-35%）选定 τ。
3. 记录选定理由到 sim 脚本注释。

**文件：** `utils/mysteryBox.sim.js`（新建，开发期保留供回归）

**验证：** node 运行出表格，人眼确认分布合理，定 τ。

---

### Step 1: mysteryBox.js 算法改造

**改动点（按 design §2、§3）：**

1. 新增 `normalizeWeights(weighted)`、`softmaxPick(weighted, tau)`、`tierByRank(...)` 函数
2. 删除 `midBandPick`（被 softmax 替代）
3. `explorePick` 改为调 softmaxPick + tierByRank
4. `mysteryBoxRecommend`：ε 改 0.15；探索分支用新 explorePick；result 增加 tier 字段
5. `longTailBonus` 修正：无评分非连锁店 0.5（不再满格 1.0）
6. `generateMysteryReason` 增加 tier 参数，按档位选文案（design §5）
7. TAU 常量用 Step 0 选定的值

**文件：** `utils/mysteryBox.js`

**验证：** node require 测试 + design §8 分布回归（跑 10000 次确认 tier 分布）。

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
3. AI 调用：`if (result.fromExplore)` 触发（softmax 方案无需排除 fallback）

**文件：** `pages/mystery/mystery.js`

**验证：** 语法检查；真机验证切 tab 不卡 opening。

---

### Step 3: 残留检查与回归

- grep 确认 `midBandPick` 无残留引用
- grep 确认无 `explore-fallback` 残留（已改 explore-mid）
- 确认 `fromExplore` 仍被页面消费（AI 调用判断）
- 跑 sim 脚本确认选定 τ 的分布稳定

---

## 回滚点

- Step 0 失败（分布都不理想）：回退到原 midBandPick，τ 方案重评
- Step 1 改动可整体 revert（mysteryBox.js 是自包含算法模块）
- Step 2 独立于 Step 1（页面层），可单独 revert

## 完成标准

- [ ] Step 0 产出 τ 选定表，τ 有数据依据
- [ ] softmax 探索替代 midBandPick，tier 分布符合产品目标
- [ ] 头部(top10%)能真实开出，长尾(bottom40%)能真实开出
- [ ] 无评分店不再因长尾加成反超高分店
- [ ] setTimeout 在 onHide/onUnload 被清理，切 tab 不卡 opening
- [ ] reason 文案按 tier 分档（head/tail/mid/exploit）
- [ ] 无 midBandPick / explore-fallback 残留
- [ ] 场景不匹配硬提示、池子耗尽、去重等现有逻辑不受影响
