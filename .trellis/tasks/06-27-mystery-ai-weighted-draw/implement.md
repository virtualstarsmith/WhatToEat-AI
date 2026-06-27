# 手气抽签 AI情境分 - 执行计划

> 配套 `design.md`。**Step 0 是 AI prompt 实测验证——本任务成败关键，必须先验证 prompt 能否稳定输出合理情境分。**

## 执行清单

### Step 0: AI prompt 实测验证（关键，先于业务代码）

**为什么必须先做：** 大模型能否稳定输出合理情境分（覆盖全部 poi_id、分值合理、不极端）是本任务的核心风险。若 prompt 不稳定，整个方案要调整（如改 prompt 结构、改输出格式）。不能盲写代码再发现 prompt 不行。

**做法：**
1. 先实现 `utils/aiContext.js` 的核心函数（prompt 构造 + 解析校验），不带缓存
2. 写一个**模拟测试入口**：在真机/模拟器临时加一个测试按钮，调 scoreSceneContext（mock 候选池 + 场景），看 AI 实际返回
3. 验证项：
   - 是否返回合法 JSON（adjustments + reason）
   - 是否覆盖全部输入的 poi_id（不漏）
   - 分值是否在 [-0.3, +0.3] 合理区间
   - 分值是否有场景逻辑（午餐快餐+、火锅-）
   - 同输入多次调用，结果是否稳定（不每次乱来）
4. 若 prompt 不稳定 → 迭代 prompt（加约束、改示例），直到稳定

**文件：** `utils/aiContext.js`（初版）+ 临时测试入口（验证后删除）

**验证：** 真机看 AI 实际返回，确认 prompt 有效。

> ⚠️ 此步需要你在真机/模拟器配合验证（我无法直接调 wx.cloud AI）。我会写好测试入口代码，你跑一次给我看返回结果。

---

### Step 1: 完善 aiContext.js（缓存 + 完整契约）

Step 0 验证 prompt 后，补全：
- 缓存层（cacheKey + Map）
- 超时控制
- 解析校验（clamp + 缺失补 0 + 丢弃编造 poi_id）
- 候选池精简（topN=15 预排序）

**文件：** `utils/aiContext.js`

**验证：** node 单测（mock AI 返回，验证缓存/校验/精简逻辑）。

---

### Step 2: sim 验证手气感（防 AI 收敛）

按 design §6：
- mock 候选池（快餐/正餐/火锅混合）
- 注入午餐情境分
- 跑 1000 次 mysteryBoxRecommend，统计类型分布 + tier 分布
- 确认快餐不垄断（<70%）、tier 不被压扁

**文件：** 临时 sim 脚本（验证后保留供回归）

**验证：** 分布合理则继续，否则调情境分范围。

---

### Step 3: mysteryBox.js 改造

- `calculateWeight(poi, scene, contextAdjust)`：base + adj
- `mysteryBoxRecommend(pois, openedIds, scene, contextAdjustments)`：加第4参数
- 向后兼容（不传 adj = 纯公式）

**文件：** `utils/mysteryBox.js`

**验证：** node 单测（带 adj / 不带 adj 两种调用）。

---

### Step 4: mystery.js 接入

- `_refreshContextAdjustments()`：场景切换/进页面时调 aiContext
- `onShow` / `onSelectScene` / 位置变化 触发预热
- 抽签调 mysteryBoxRecommend 传 contextAdjustments
- loading 反馈（contextLoading）
- reason 改造：contextReason + tier 文案，弱化 callMysteryAIReason

**文件：** `pages/mystery/mystery.js`

**验证：** 真机端到端：切场景看 AI 情境预热 → 抽签看结果是否体现情境（午餐多快餐）→ reason 是否含场景理由。

---

### Step 5: 残留检查与回归

- grep 确认 aiContext.js 被正确 require
- 确认 callMysteryAIReason 默认流程不再调用（或仅极端兜底）
- 确认 AI 失败时回退纯公式（断网测试）
- 确认抽签不阻塞（情境未就绪也能抽）

---

## 回滚点

- Step 0 失败（prompt 死活不稳）：方案重评，可能退回"纯公式 + 事后理由"现状
- Step 2 失败（手气感丧失）：调情境分范围，或稀释策略
- Step 3-4 可整体 revert（情境分是叠加层，移除即回退纯公式）

## 完成标准

- [ ] Step 0：AI prompt 实测稳定（覆盖全 poi_id、分值合理、有场景逻辑）
- [ ] aiContext.js：scoreSceneContext（缓存+校验+精简+兜底 null），可单测
- [ ] Step 2：手气感 sim 通过（类型分布多元、tier 不压扁）
- [ ] mysteryBox.js：calculateWeight + mysteryBoxRecommend 接入情境分
- [ ] mystery.js：场景切换预热 AI、抽签传参、loading 反馈、reason 改造
- [ ] AI 失败回退纯公式，抽签不阻塞
- [ ] 真机端到端：切场景→情境生效→抽签体现情境→reason 含场景理由
- [ ] aiContext.js 可被甄选子任务复用

## Notes

- **本任务高度依赖 AI 实测**，无法纯 node 验证 prompt 效果。Step 0 需要你真机配合跑测试入口。
- 若你无法频繁真机验证，可考虑：我先实现完整代码（含 prompt），你最后一次性真机端到端验证，发现问题再迭代。但这违背"先验证 prompt"的谨慎原则，风险较高。
- 建议优先 Step 0 先跑通 prompt，再展开后续。
