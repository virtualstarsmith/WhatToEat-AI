# AI甄选快捷筛选栏 - 执行计划

> 配套 `design.md`。按顺序执行，每步可独立验证。

## 执行清单

### Step 1: 新建 `utils/poiFilter.js`（纯函数模块）

创建过滤工具，三个维度 + 组合入口。

**实现要点：**
- 导出 `filterPois(pois, filters)`，返回浅拷贝新数组
- 快餐/正餐关键词从 `config/scenes.js` 读取（午餐.快餐 / 晚餐.正餐+菜系+火锅烧烤），不硬编码
- 匹配方式与 `matchesScene` 一致：`name + type` 子串命中
- cost 宽松包含：`cost == null` 时一律保留
- 档位上限语义：cheap(≤30)、medium(≤50)，medium 包含 cheap 的店

**文件：** `utils/poiFilter.js`（新建）

**验证：** 在微信开发者工具控制台手动 require 测试，或直接进入 Step 2 后真机验证。

---

### Step 2: index.js 接入 filter

**改动点：**

1. **顶部 require**：引入 `filterPois`
2. **data 新增**：
   - `filterGroups`（三组 chip 定义，见 design §4）
   - `filters: { price: '', distance: '', category: '' }`（默认全不限）
3. **`callRecommend(pois)` 改造**：
   - 开头加 `const filtered = filterPois(pois, this.data.filters)`
   - **池子耗尽保护**：`if (filtered.length === 0)` → showToast "当前筛选下无商家，试试放宽条件"，return（不清空旧 cardsView，避免闪空）
   - 下游 `scoreCandidates` / `_useFallbackRecommend` 的 pois 参数从 `pois` 改为 `filtered`
4. **新增 `onSelectFilter(e)`**：
   - 读取 `data-key` / `data-value`
   - loading/refreshing 守卫（与 onSelectScene 一致）
   - 更新 `filters[key]`
   - 重置 `excludeIds / recommendations / cardsView / source`
   - 标记 loading，调 `callRecommend(this.data.pois)`
5. **`_useFallbackRecommend` 改造**：pois 参数改用 filtered（需把 filtered 传入或内部重新 filter）

**文件：** `pages/index/index.js`

**验证：** 真机选各档位，列表是否符合预期。

---

### Step 3: index.wxml 加筛选栏 UI

**改动点：**

场景栏（`scene-section`）下方、banner/cards 上方，加 `filter-section`。

**实现要点：**
- `wx:if="{{locationOk}}"`（未授权不显示）
- 三组 chip 横向排列，复用场景栏 chip 视觉风格（圆角小标签）
- 选中态 `filter-chip-active` 高亮

**文件：** `pages/index/index.wxml`

**验证：** 真机看筛选栏位置和样式。

---

### Step 4: index.wxss 加筛选栏样式

**改动点：**

新增 `.filter-section / .filter-group / .filter-chips / .filter-chip / .filter-chip-active` 样式。

**实现要点：**
- 视觉与场景栏 chip 保持同一设计语言（圆角、字号、选中色）
- 三组之间用间距或分隔区分，避免视觉拥挤
- 复用主色 `#FF6B35` 作为选中态

**文件：** `pages/index/index.wxss`

**验证：** 真机视觉确认。

---

### Step 5: 纯函数测试 poiFilter

**可选但推荐**（对应 design §8）：

在微信开发者工具控制台或临时测试脚本里验证：
- 各档位单独过滤（price cheap/medium、distance near/walk、category fastfood/formal）
- 组合过滤（price + distance + category 同时）
- cost=null 宽松包含
- 空池子返回空数组
- category 过滤掉茶饮（验证 fastfood/formal 都不含奶茶店）

**验证命令：** 控制台 `require('utils/poiFilter.js').filterPois(mockPois, {category:'fastfood'})`

---

## 回滚点

- Step 1-2 出错：删除 poiFilter.js，还原 index.js（filter 无下游依赖，回滚干净）
- Step 3-4 出错：还原 wxml/wxss（UI 独立于逻辑）

## 完成标准

- [ ] `utils/poiFilter.js` 纯函数可独立 require
- [ ] index 页显示三组筛选 chip，选中态正确
- [ ] 选"¥30内"列表只出现 cost≤30 或 cost=null 的店
- [ ] 选"500m"列表只出现 distance≤500 的店
- [ ] 选"快餐"/"正餐"列表只出现对应品类（茶饮被过滤）
- [ ] 筛选切换时旧推荐清空、重新加载，无错乱
- [ ] 筛选+换一批叠加正常（换一批在筛选后的池子内去重）
- [ ] filter 后池子为空时提示"试试放宽条件"，不闪空
- [ ] 未授权定位时不显示筛选栏
- [ ] 不破坏现有场景栏、loading、兜底逻辑
