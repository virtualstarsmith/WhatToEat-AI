# 手气抽签：AI调权重的感性决策

## 背景

抽签现状审计（见父任务）：AI 只在选好店后编理由，**选店决策由 `0.4距离+0.4质量+0.2长尾` 硬编码公式 + Math.random 完成，AI 零参与**。

本任务让 AI 真正进入抽签决策：**场景切换时 AI 算出该场景的权重 profile，抽签用 AI 权重替代硬编码权重做随机选店。** 随机骨架不变（保手气感），AI 注入场景智能。

同时，本任务负责定义**被两个 Tab 共用的 AI 权重引擎 `utils/aiWeights.js`**（父任务指定的统一抽象）。

## 范围

### 1. 新建 AI 权重引擎 `utils/aiWeights.js`（核心产物，两Tab共用）

**契约：**
```
async getSceneWeights(scene, ctx?) → Promise<WeightsProfile>
  输入：scene（场景名），ctx（可选：时刻/位置采样等语境）
  输出：{
    distance: number,   // 距离权重 0~1
    quality: number,    // 质量权重 0~1
    longtail: number,   // 长尾权重 0~1
    reason: string      // AI 解释为何这套权重（如"午餐时段偏近偏快"）
  }
```

**行为：**
- 同一 scene 调用返回**缓存结果**（场景权重不随每次抽签变，仅场景切换时重算）
- AI 失败/超时 → 回退硬编码 profile（抽签用现状 0.4/0.4/0.2，甄选用 0.5/0.5）
- AI 调用走现有 `streamAiText`（复用基础设施）

**AI prompt 设计（design 重点）：**
- 输入：场景名 + 场景的常识性偏好提示（午餐=求快求近、晚餐=求好求放松...）
- 输出：严格 JSON 的 WeightsProfile + 一句 reason
- 约束：三权重在合理区间（如 distance 0.3~0.6），避免 AI 给极端值破坏随机稳定性

### 2. 抽签接入 AI 权重（mysteryBox.js 改造）

- `calculateWeight` 的权重从硬编码改为**读取当前场景的 AI 权重 profile**
- `mysteryBoxRecommend(pois, openedIds, currentScene)` 内部：先 `await getSceneWeights(currentScene)` → 用返回的 weights 算每个候选权重 → 进入现有 E&E + 降幂加权随机
- 抽签动作本身**仍瞬时**（权重已由场景切换时预计算并缓存）

### 3. 场景切换触发 AI 权重计算（mystery.js 改造）

- 进页面/切场景时：调用 `getSceneWeights(scene)` 预热（显示 loading 或"AI正在揣摩你的口味..."反馈）
- 抽签时直接用缓存的权重，不等待 AI

### 4. reason 从"事后编"变"真实推理"

- 现在：选好店 → callMysteryAIReason 编理由（AI 只看单店）
- 重构后：理由基于 **AI 权重的 reason 字段**（AI 算权重时已解释"为何这套偏好"）+ 抽中档位（head/tail/mid）的组合
- 减少/弱化 callMysteryAIReason（理由前置到权重计算阶段），降低 AI 调用次数

## 涉及文件

- `utils/aiWeights.js`（新建，AI 权重引擎）
- `utils/mysteryBox.js`（calculateWeight 用 AI 权重；mysteryBoxRecommend 接 getSceneWeights）
- `pages/mystery/mystery.js`（场景切换时预热 AI 权重；reason 改用权重引擎的 reason）
- 可能调整 `utils/scoring.js`（scoreCandidates 接受动态权重而非固定 weights 参数）—— design 确认

## 验收标准

- [ ] `utils/aiWeights.js` 实现 getSceneWeights（带缓存、带兜底），可被 node 单测
- [ ] 场景切换时触发 AI 权重计算，有 loading/反馈（用户知道 AI 在思考）
- [ ] 抽签选店使用 AI 返回的权重（非硬编码 0.4/0.4/0.2）
- [ ] 抽签动作瞬时（用缓存权重，不等待 AI）
- [ ] AI 失败时回退硬编码权重，抽签功能不中断
- [ ] 手气感保留：连抽仍有明显随机性（AI 权重不导致结果过度收敛）—— design 需论证/测试
- [ ] reason 反映 AI 权重的真实推理（如午餐抽中近店，理由是"AI觉得午餐该求快"而非事后编）
- [ ] AI 权重引擎可被甄选子任务复用（单一事实源）

## Notes

- **核心难点：** AI prompt 如何让大模型输出合理且不极端的 WeightsProfile。需 design 设计 prompt + 用模拟测试验证 AI 输出的稳定性。
- **手气感验证：** 同场景连抽 N 次，结果分布应仍有明显方差（不能因 AI 权重让头部垄断）。design 需包含分布测试。
- 本任务定义 aiWeights.js 契约，子任务3（甄选）直接复用。
- 复杂任务，需 design.md（prompt 设计、缓存策略、手气感验证、兜底）+ implement.md。
