# 扩大 POI 候选池 - 技术设计

## 1. 架构概览

### 1.1 改造范围

只动 `getPoi` 云函数；下游数据层与两个页面零改动、自动受益。

```
pages/index (AI)  ──┐
                    ├──► utils/locationHelper.fetchPois ──► wx.cloud.callFunction('getPoi')
pages/mystery     ──┘                                              │
                                                                   ▼
                                                    ┌──────────────────────────────┐
                                                    │  cloudfunctions/getPoi        │
                                                    │  (本次改造)                    │
                                                    │                               │
                                                    │  page1 ──► Amap /around        │
                                                    │  page2 ──┤  (Promise.all 并行)  │
                                                    │  page3 ──┤                     │
                                                    │  page4 ──┘                     │
                                                    │       │                       │
                                                    │       ▼                       │
                                                    │  去重(location+name) → 排序    │
                                                    │       │                       │
                                                    │       ▼                       │
                                                    │  { status:'ok', pois:[..100] }│
                                                    └──────────────────────────────┘
```

### 1.2 模块边界

| 模块 | 职责 | 本次改动 |
|------|------|---------|
| `cloudfunctions/getPoi/index.js` | 高德周边搜索代理 + 翻页聚合 + 去重排序 | **重构** |
| `cloudfunctions/getPoi/config.json` | 云函数超时配置 | **新增** |
| `utils/locationHelper.js` | 缓存 + 调用 getPoi + 写 globalData | 不变 |
| `pages/index` / `pages/mystery` | 消费 `pois` | 不变（自动受益） |

## 2. 核心算法设计

### 2.1 自适应翻页策略

```javascript
const PAGE_SIZE = 25;   // 高德周边搜索单页上限（offset 上限）
const MAX_PAGES = 4;    // 候选池上限 ≈ 100 家
```

流程：
1. 先请求第 1 页（`page=1`）。
2. 读取响应里的 `count`（总匹配数）。
3. 计算需要拉的总页数：`pagesNeeded = min(MAX_PAGES, ceil(count / PAGE_SIZE))`。
   - `count ≤ 25` → `pagesNeeded = 1` → 不再翻页，**稀疏地区零额外开销**。
   - `count = 200` → `pagesNeeded = 4`（被 MAX_PAGES 截断）。
4. `pagesNeeded > 1` 时，对第 2..N 页用 `Promise.all` **并行**请求。
5. 聚合所有页的 `pois`。

### 2.2 单页请求（重构现有 amapNearby）

把现有 `amapNearby(longitude, latitude, radius)` 改为 `amapNearbyPage(longitude, latitude, radius, page)`，URL 增加 `&page=${page}`，其余（`types=050000`、`offset=25`、`extensions=all`、`key`、15s 超时）不变。

```javascript
function amapNearbyPage(longitude, latitude, radius, page) {
  const path =
    `/v3/place/around?location=${longitude},${latitude}` +
    `&types=050000&radius=${radius}&key=${AMAP_KEY}` +
    `&extensions=all&offset=${PAGE_SIZE}&page=${page}`;
  const options = { hostname: 'restapi.amap.com', path, method: 'GET', timeout: 15000 };
  // ... 同现有 Promise 封装 ...
}
```

> 注：单请求超时仍 15s。并行后整体 wall time ≈ max(单请求) ≤ 15s，云函数超时 20s 足够覆盖。

### 2.3 去重

跨页可能在距离阈值边界返回同一商家。按 `(location + name)` 复合键去重：

```javascript
const seen = new Set();
const deduped = allPois.filter((p) => {
  const key = `${p.location || ''}|${p.name || ''}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
```

> 用 `location`（经纬度串）作主键最稳；加 `name` 防止极端情况下 location 缺失的误合并。

### 2.4 排序与标准化

去重后统一 `normalizePoi`（复用现有函数，`distance` 已 `parseInt`），再按 `distance` 升序排序，保证"最近优先"语义与现状一致：

```javascript
const pois = deduped
  .map(normalizePoi)
  .sort((a, b) => (a.distance || 0) - (b.distance || 0));
```

### 2.5 main 主流程伪代码

```javascript
exports.main = async (event) => {
  const { longitude, latitude, radius = 2000 } = event || {};
  if (longitude == null || latitude == null) return { status: 'error', message: 'longitude/latitude required', pois: [] };
  if (!AMAP_KEY) return { status: 'error', message: 'AMAP_KEY env not set', pois: [] };

  try {
    // 第 1 页
    const first = await amapNearbyPage(longitude, latitude, radius, 1);
    if (first.status !== '1') {
      return { status: 'error', message: first.info || 'AMAP error', infocode: first.infocode || '', pois: [] };
    }
    const totalCount = parseInt(first.count, 10) || 0;
    let allPois = [...(first.pois || [])];

    // 自适应翻页
    const pagesNeeded = Math.min(MAX_PAGES, Math.ceil(totalCount / PAGE_SIZE));
    if (pagesNeeded > 1) {
      const restPages = Array.from({ length: pagesNeeded - 1 }, (_, i) => i + 2);
      const results = await Promise.all(
        restPages.map((p) => amapNearbyPage(longitude, latitude, radius, p).catch(() => null))
      );
      for (const r of results) {
        if (r && r.status === '1' && Array.isArray(r.pois)) allPois.push(...r.pois);
      }
    }

    // 去重 → 标准化 → 排序
    const seen = new Set();
    const deduped = allPois.filter((p) => {
      const key = `${p.location || ''}|${p.name || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const pois = deduped.map(normalizePoi).sort((a, b) => (a.distance || 0) - (b.distance || 0));

    return { status: 'ok', pois };
  } catch (e) {
    console.error('getPoi error:', e.message);
    return { status: 'error', message: e.message, pois: [] };
  }
};
```

## 3. 错误处理与降级

| 场景 | 处理 |
|------|------|
| 第 1 页成功，追加页部分失败 | `.catch(() => null)` → 跳过失败页，聚合已成功页，`status='ok'` 返回（部分结果也比只有 25 家强） |
| 第 1 页就失败 / `status !== '1'` | 直接返回 `{ status: 'error', ... }`，与现状一致 |
| 所有页 pois 为空 | 返回 `{ status: 'error', message: '附近暂无餐饮商家' }`（与 `locationHelper` 既有空判断对齐） |
| 单页超时 15s | 该页 reject → 被降级吞掉；不影响其他页 |

> 第 1 页是"主"页：它的成败决定整体 status；后续页是"尽力而为"的增量。

## 4. 云函数超时配置

新增 `cloudfunctions/getPoi/config.json`：

```json
{
  "timeout": 20,
  "memorySize": 256
}
```

> WeChat 云函数默认超时较短（默认 3s，控制台可调至 60s）。4 路并行高德请求在 CBD 可能接近 10s，设 20s 留足余量。部署后需在云开发控制台确认超时生效（`config.json` 与控制台设置以控制台最终值为准，必要时手动同步）。

## 5. 兼容性

### 5.1 向后兼容
- 返回结构 `{ status, pois }` 与单条 POI 字段（`normalizePoi` 产物）完全不变。
- `locationHelper.fetchPois` 仅消费 `result.status` / `result.pois`，无需改动。
- `radius` 默认值 2000 不变，调用方无需传新参数。

### 5.2 下游影响（正面、零改动）
- **AI 页**：`scoreCandidates` 评分池从 ≤25 扩到 ≤100，`topN(scored, 7)` 从更优范围选 7 家 → GLM 候选质量提升。
- **盲盒页**：`qualifyFilter` 后的候选池显著变大 → Epsilon-Greedy 探索范围更广，`longTailBonus`（特色小店加权）有更多目标可命中。
- **内存**：`globalData.pois` 从 ~25 条 → 最多 ~100 条小对象，内存增量可忽略；`setData` 到页面同样无压力。

### 5.3 poi_id 稳定性
两页均用 `poi_id = String(idx)`（数组下标）。池子变大只是 idx 范围从 0-24 扩到 0-99，`excludeIds` / 盲盒去重逻辑无影响。

## 6. 关键权衡

### 6.1 为何翻页而非扩大 radius
- CBD 是"密度高"不是"范围小"。2km 已覆盖写字楼周边充足餐厅；扩到 3~5km 会拉入远距离、用户不愿走、且常低分的店，稀释质量、加重 `qualifyFilter` 负担。
- 翻页拿"更全的近店"，扩 radius 拿"更远的店"——前者更符合"附近推荐"产品定位。

### 6.2 为何上限 100 而非更多
- 100 家过 `qualifyFilter` 后 CBD 剩 ~40-60 家，盲盒连开十几次不重样，惊喜度够。
- 150+ 边际递减，且 `globalData` 占用、云函数耗时、Amap 配额都线性上升。
- 100 是"推荐档"的成本/收益平衡点。

### 6.3 为何自适应（用 count）而非固定拉 4 页
- 稀疏地区（郊区、夜间）`count` 常 ≤25，固定拉 4 页会浪费 3 次空请求 + 配额。
- 自适应让非 CBD 用户**零额外开销**，只在真正密集时才付成本。

### 6.4 为何并行而非串行
- 串行 4 页最坏 4×15s=60s，超云函数上限。
- 并行 wall time ≈ 单页耗时，配合 20s 超时安全。

## 7. 成本与配额

- 单次 `getPoi`（CBD）从 1 次 → 最多 4 次高德调用。
- `locationHelper` 的 5 分钟缓存兜底：同坐标、同会话不重复打云函数，实际放大倍数远小于 4。
- 高德个人开发者周边搜索日配额通常数千米级，正常使用无忧；建议上线后关注配额用量（见监控）。

## 8. 监控点（上线后关注）

- 云函数调用耗时 P95（确认 4 路并行未超 20s）。
- `getPoi` 错误率（区分第一页失败 vs 追加页失败）。
- 高德 API 日调用次数 / 配额余量。
- （可选）日志打印 `totalCount` 与实际返回 `pois.length`，验证自适应生效。

## 9. 回滚方案

- 纯云函数改动，无数据库、无前端 Breaking。
- 回滚 = 在云开发控制台重新部署上一个版本的 `getPoi`（或 `git revert` + 重新上传部署）。
- 回滚后立即恢复 25 家单页行为，下游无感知。
