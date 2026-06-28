# 手气抽签：AI情境分的感性决策

## 背景

抽签现状审计（见父任务）：AI 只在选好店后编理由，**选店决策由 `0.4距离+0.4质量+0.2长尾` 硬编码公式 + Math.random 完成，AI 零参与**。

## 方案演进（重要：原"调权重"方案已被证伪）

**初版方案"AI 调三个数值权重"已用 sim 证伪**——不同权重 profile（0.4/0.4/0.2 vs 0.6/0.3/0.1）下，选店 top 结果几乎不变（距离和质量高度相关，调比例改变不了"又近又好的店必然胜出"）。伪 AI 化，放弃。

**改为方案 X：AI 给候选店打情境分。** sim 验证有效：午餐 AI 抬升快餐/压制火锅，晚餐相反，两个场景 top3 **零重叠**。这才是"距离+评分表达不了的、只有 AI 能注入的智能"。

## 核心机制

AI 不再调全局权重，而是**针对候选池里的每家店，给出情境调整分**：

```
最终分数 = 公式 base score（距离+质量+长尾，不变）
         + AI 情境分（-0.3 ~ +0.3，针对当前场景对这家店的判断）

AI 情境分示例（午餐场景）：
  快餐店 → +0.3（午餐求快，快餐合适）
  火锅店 → -0.2（午餐吃火锅太慢太重）
  远但网红的特色店 → +0.2（值得专程）
```

**为什么情境分有效而调权重无效：** 情境分引入了"距离质量表达不了的信息"（店的类型是否适合当前场景、是否值得专程、情境匹配度），直接改变每家店的相对排名。sim 实证。

## 范围

### 1. 新建 AI 情境引擎 `utils/aiContext.js`（核心产物，两Tab共用）

**契约：**
```
async scoreSceneContext(pois, scene, ctx?) → Promise<{
  adjustments: { [poi_id]: number },  // 每店情境分 -0.3~+0.3
  reason: string                       // AI 对该场景选店倾向的一句话总结
} | null>
```

**行为：**
- 输入：候选池 pois（精简后送 AI，避免 token 爆炸）+ 场景名
- 输出：每店的情境调整分 + 一句场景理由
- 同场景+同候选池指纹 → 缓存（场景/位置不变则不重算）
- AI 失败/超时 → 返回 null（调用方回退纯公式，无情境分）
- 复用现有 `streamAiText`

**AI prompt 设计（design 重点）：**
- 输入：场景 + 候选池（每店：poi_id/名称/类型/距离/评分/人均，精简字段）
- 指令：为每家店打 -0.3~+0.3 的情境分（正值=适合本场景，负值=不适合），输出 JSON
- 约束：分值在合理区间，避免极端值破坏随机稳定性；必须覆盖所有输入的 poi_id

### 2. 抽签接入 AI 情境分（mysteryBox.js 改造）

- `calculateWeight` 增加 `contextAdjust` 参数：`base + contextAdjust`
- `mysteryBoxRecommend(pois, openedIds, currentScene, contextAdjustments)` 新增 contextAdjustments 入参
- 抽签动作瞬时：情境分由场景切换时预计算并缓存，抽签直接用

### 3. 场景切换触发 AI 情境计算（mystery.js 改造）

- 进页面/切场景：调 `scoreSceneContext(pois, scene)` 预热（loading 反馈"AI 正在揣摩你的口味..."）
- 结果缓存到 data，抽签时传入

### 4. reason 从"事后编"变"场景理由 + 档位"

- 现状：选好店 → callMysteryAIReason 编理由（只看单店）
- 重构：reason = AI 情境引擎的 `reason`（场景级，如"午餐求快，帮你挑了快餐"）+ 抽中档位（head/tail/mid）
- 弱化 callMysteryAIReason（理由前置到情境计算阶段），减少 AI 调用

## 涉及文件

- `utils/aiContext.js`（新建，AI 情境引擎）
- `utils/mysteryBox.js`（calculateWeight 加 contextAdjust；mysteryBoxRecommend 加 contextAdjustments 入参）
- `pages/mystery/mystery.js`（场景切换预热 AI 情境；reason 改用引擎 reason）
- 可能调整 `utils/scoring.js`（scoreCandidates 接受可选 contextAdjustments map）—— design 确认

## 验收标准

- [ ] `utils/aiContext.js` 实现 scoreSceneContext（带缓存、带兜底 null），可被 node 单测
- [ ] 场景切换时触发 AI 情境计算，有 loading/反馈
- [ ] 抽签选店使用 base + AI 情境分（非纯公式）
- [ ] 抽签动作瞬时（用缓存情境分，不等待 AI）
- [ ] AI 失败时回退纯公式（无情境分），抽签功能不中断
- [ ] 手气感保留：同场景连抽仍有随机性（情境分不导致结果过度收敛）—— design 需 sim 验证
- [ ] reason 反映 AI 场景理由（如"午餐求快"），非事后编
- [ ] AI 情境引擎可被甄选子任务复用（单一事实源）

## Notes

- **核心难点：** AI prompt 让大模型为每家店输出合理情境分（类型匹配、不极端、覆盖全部 poi_id）。需 design 设计 prompt + sim 验证稳定性。
- **候选池大小：** 送 AI 的池子要精简（如 top15-20 家），避免 token 爆炸 + AI 评分疲劳。design 确定精简策略。
- **手气感验证：** 情境分 + 降幂加权随机，连抽分布需仍有方差。design 含分布测试。
- 本任务定义 aiContext.js 契约，子任务3（甄选）直接复用。
- 复杂任务，需 design.md（prompt 设计、精简策略、缓存、手气感验证、兜底）+ implement.md。
