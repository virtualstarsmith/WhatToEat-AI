# AI甄选快捷筛选栏 - 技术设计

> 配套 `prd.md`。本设计聚焦四个关键决策：filter 层位置、cost 为空策略、快餐/正餐映射、筛选与 exclude 的交互。

## 1. 数据契约（POI 字段可用性确认）

经查 `cloudfunctions/getPoi/index.js` normalizePoi 与实际高德返回：

| 字段 | 类型 | 来源 | 筛选可用性 |
|---|---|---|---|
| `cost` | int \| null | `biz_ext.cost` parseInt | ⚠️ **高频缺失**（高德人均数据覆盖低） |
| `distance` | int | 高德 `poi.distance` | ✅ 必有（附近搜索必返回） |
| `type` | string | 高德 `poi.type`（多级分类串，`;` 分隔） | ✅ 必有，但需经 `normalizePoiType` 清洗 |
| `typecode` | string | 高德 typecode（050xxx 系列） | ✅ 必有 |
| `rating` | float \| null | `biz_ext.rating` | 同 cost，高频缺失 |

**关键约束：cost 和 rating 都可能为 null。** 筛选设计必须显式处理空值，否则会误杀大量真实商家。

## 2. 核心决策

### 决策 A：filter 层位置 —— 新建 `utils/poiFilter.js`

**不复用 `scoring.js`。** 理由（对应 spec/frontend 代码复用原则）：

- `scoring.js` 的职责是"原语 + 聚合打分"（distanceScore/qualityScore/scoreCandidates），注释明确写了"不含场景乘数、长尾加成、topN 等页面专属逻辑——避免过度抽象"
- filter 是独立关注点（布尔过滤，非打分），塞进 scoring 违反其单一职责
- 新建 `utils/poiFilter.js` 导出纯函数，**可被单元测试 require**（与 scoring/aiRecommend 的可测性模式一致）

**模块契约：**
```js
// utils/poiFilter.js
// 三个维度的过滤函数 + 组合入口

/**
 * 按筛选条件过滤 POI 列表。纯函数，无副作用。
 * @param {Array} pois - 标准化 POI 数组
 * @param {Object} filters - { price, distance, category }，每个字段为档位 key 或 null/''（不限）
 * @returns {Array} 过滤后的 pois（浅拷贝新数组，不改原数组）
 */
function filterPois(pois, filters) { ... }
```

### 决策 B：cost 为空策略 —— "宽松包含"

**问题**：若选"¥30内"，cost=null 的店要不要显示？

**选项对比：**

| 策略 | 行为 | 后果 |
|---|---|---|
| 严格过滤 | cost=null 被排除 | ❌ 池子大幅缩水（高德 cost 覆盖率低），用户感觉"没店了" |
| 宽松包含 | cost=null 一律保留 | ✅ 宁可多显示不可漏显示；用户看不到人均但能看到店 |
| 排除带筛选 | cost=null 只在"不限"时显示 | ⚠️ 折中，但逻辑绕 |

**采用"宽松包含"**：选价格档位时，cost=null 的店**保留**（不过滤）。理由：
1. 高德 cost 数据覆盖率低，严格过滤会误杀大量真实商家
2. 用户选"¥30内"的意图是"别推贵的"，cost=null 的店通常是平价小店（无人均数据的多为非连锁小店），符合"别推贵的"心智
3. 实现简单，逻辑可解释

**cost 档位定义：**
- `cheap`：cost ≤ 30（"¥30内"）
- `medium`：cost ≤ 50（"¥50内"）—— 注意是 ≤50 包含 ≤30 的店
- `''`（不限）：不过滤

> 注意：medium(≤50) 包含 cheap(≤30)。档位是"上限"语义，非互斥区间。选 medium 时 cheap 的店也显示。

### 决策 C：快餐/正餐映射 —— 复用 scenes.js 关键词

**不新建关键词表。** `config/scenes.js` 已有完整菜系/品类关键词库，直接复用：

- **快餐**：复用 `午餐.match.快餐` 的 alias（`快餐/简餐/便当/盖饭/盒饭/黄焖鸡/麻辣烫/砂锅/炒饭/水饺/饺子/馄饨/排骨饭`）+ 早餐的面点/粉面（轻食类）
- **正餐**：复用 `晚餐.match.正餐`（`正餐/饭店/酒楼/餐厅/私房菜/小炒/炒菜/家常菜`）+ `晚餐.match.菜系`（`川菜/湘菜/粤菜/鲁菜/东北菜/西餐/日料/寿司/韩餐/泰餐/海鲜`）+ `晚餐.match.火锅烧烤`

**实现：** `utils/poiFilter.js` 从 scenes.js 读取关键词，不硬编码。匹配方式与 `matchesScene` 一致（name+type 子串命中）。

**关键限制（设计权衡）：**
- 茶饮/咖啡/甜品（下午茶）既不算快餐也不算正餐 → 选"快餐"或"正餐"时，这些店**被过滤掉**
- 这是**可接受的副作用**：用户选"快餐/正餐"的语义就是"我要吃饭"，茶饮本就不该出现
- 若 POI 既不命中快餐也不命中正餐（如小吃摊）→ 两个档位都过滤掉它。**这是已知行为**，不修复（修复需引入第三档"其他"，过度设计）

### 决策 D：筛选与 exclude（换一批）的交互 —— 筛选切换时清空 exclude

**问题**：用户选了"¥30内"，换了 2 批（exclude 累积了推过的店），然后改成"¥50内"——exclude 要不要清？

**决策：筛选切换时清空 exclude + 推荐结果。** 理由：
1. 筛选变了，候选池变了，旧的 exclude 可能把新池子里的好店排除掉（语义错乱）
2. 与现有"场景切换"逻辑完全一致（`onSelectScene` 里 `excludeIds: []` + 清空 cardsView）——复用同一模式，降低认知成本

**交互流程（类比 onSelectScene）：**
```
用户点筛选档位
  → 清空 excludeIds / recommendations / cardsView / source
  → 标记 loading
  → callRecommend(pois)  // 内部先用 filterPois 过滤再 scoreCandidates
```

## 3. 数据流（集成点）

现有 `callRecommend(pois)` 流程：
```
pois → scoreCandidates(pois, scene, excludeIds) → topNWithExplore → callAIRecommend → cardsView
```

新流程：
```
pois → filterPois(pois, filters) → scoreCandidates(filtered, scene, excludeIds) → topNWithExplore → callAIRecommend → cardsView
                                     ^^^^^^^^
                          filter 后的池子作为 scoring 输入
```

**关键：filter 在 scoreCandidates 之前，作用于原始 pois。** 这样：
- AI 候选从过滤后的池子里挑（符合用户筛选意图）
- 兜底路径 `_useFallbackRecommend` 也用过滤后的池子
- exclude（换一批去重）在过滤后的池子内生效，互不干扰

**改动点（index.js）：**
- `callRecommend` 开头加一行：`const filtered = filterPois(pois, this.data.filters)`
- `scoreCandidates` 和 `_useFallbackRecommend` 的 pois 参数从 `pois` 改为 `filtered`
- **池子耗尽保护**：filter 后若 `filtered.length === 0`，提示"当前筛选下无商家，试试放宽条件"，不进入推荐流程

## 4. UI 设计

### 筛选栏位置
场景栏（scene-section）下方、卡片列表上方。横向 chip 组，三组并排或分行。

### WXML 结构（新增，复用场景栏 chip 模式）
```xml
<view class="filter-section" wx:if="{{locationOk}}">
  <view class="filter-group" wx:for="{{filterGroups}}" wx:for-item="group" wx:key="key">
    <view class="filter-chips">
      <view
        wx:for="{{group.options}}"
        wx:for-item="opt"
        wx:key="value"
        class="filter-chip {{filters[group.key] === opt.value ? 'filter-chip-active' : ''}}"
        data-key="{{group.key}}"
        data-value="{{opt.value}}"
        bindtap="onSelectFilter"
      >{{opt.label}}</view>
    </view>
  </view>
</view>
```

### 筛选组定义（index.js data）
```js
filterGroups: [
  {
    key: 'price',
    options: [
      { value: '', label: '不限' },
      { value: 'cheap', label: '¥30内' },
      { value: 'medium', label: '¥50内' }
    ]
  },
  {
    key: 'distance',
    options: [
      { value: '', label: '不限' },
      { value: 'near', label: '500m' },
      { value: 'walk', label: '1km' }
    ]
  },
  {
    key: 'category',
    options: [
      { value: '', label: '不限' },
      { value: 'fastfood', label: '快餐' },
      { value: 'formal', label: '正餐' }
    ]
  }
],
filters: { price: '', distance: '', category: '' }
```

### 档位实现映射
| 维度 | 档位 | 过滤逻辑 |
|---|---|---|
| price | `cheap` | `cost <= 30 \|\| cost == null`（宽松包含） |
| price | `medium` | `cost <= 50 \|\| cost == null` |
| distance | `near` | `distance <= 500` |
| distance | `walk` | `distance <= 1000` |
| category | `fastfood` | 命中快餐关键词集 |
| category | `formal` | 命中正餐关键词集 |

## 5. 边界与失败处理

| 场景 | 处理 |
|---|---|
| filter 后池子为空 | showToast "当前筛选下无商家，试试放宽条件"，不进推荐流程，保留旧 UI 状态（不闪空） |
| 筛选切换时正在 loading | 与场景切换一致：loading/refreshing 中禁止切换（onSelectFilter 加守卫） |
| 筛选 + 场景同时生效 | 两者叠加：filter 先过滤，scene 乘数后施加。互不冲突 |
| 筛选 + 换一批 | 换一批在 filtered 池子内 exclude，正常工作 |
| 用户未授权定位 | 筛选栏不显示（`wx:if="{{locationOk}}"`） |

## 6. 兼容性

- **不破坏现有场景栏、loading、兜底、换一批逻辑**：filter 是 scoreCandidates 前的纯过滤层，下游无感知
- **不修改 scoring.js / mysteryBox.js**：filter 只在 index.js 调用，盲盒页不受影响
- **不修改 restaurant-card 组件**：筛选只影响候选池，不影响卡片渲染
- **POI 数据契约不变**：filter 只读 cost/distance/type，不新增字段

## 7. 不做的事（防 scope 蔓延）

- ❌ 不做口味（辣/不辣）维度（PRD 评审已砍，菜系推断误差大）
- ❌ 不做筛选状态持久化（刷新/重进不记忆筛选，每次进入默认"不限"）
- ❌ 不做筛选与 AI prompt 的联动（不把用户筛选告诉 AI，AI 仍只看候选列表）——候选池已过滤，AI 自然只在筛选后的店里挑
- ❌ 不做多选（每个维度单选互斥档位 + 不限）

## 8. 验证策略

- **纯函数测试**：`utils/poiFilter.js` 的 `filterPois` 用 mock POI 数组测试各档位组合、空值、空池子
- **真机验证**：各档位筛选后列表是否符合预期、筛选+换一批叠加、池子耗尽提示
