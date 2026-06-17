# 扩大 POI 候选池 - 执行计划

## 改动清单

| # | 文件 | 动作 | 说明 |
|---|------|------|------|
| 1 | `cloudfunctions/getPoi/index.js` | 重构 | 翻页聚合 + 去重 + 排序 |
| 2 | `cloudfunctions/getPoi/config.json` | 新增 | 超时 20s |

> 下游（`utils/locationHelper.js`、`pages/index`、`pages/mystery`）**不改**，自动受益。

## 执行步骤（顺序）

### Step 1 — 新增云函数超时配置
- [ ] 创建 `cloudfunctions/getPoi/config.json`：
  ```json
  { "timeout": 20, "memorySize": 256 }
  ```
- **验证**：文件存在、JSON 合法。

### Step 2 — 重构 `amapNearby` 为分页版
- [ ] 将 `amapNearby(longitude, latitude, radius)` 改为 `amapNearbyPage(longitude, latitude, radius, page)`。
- [ ] URL 增加 `&page=${page}`；提取常量 `PAGE_SIZE = 25`。
- [ ] 保持 `types=050000`、`offset=${PAGE_SIZE}`、`extensions=all`、`timeout: 15000` 不变。
- **验证**：`node -c cloudfunctions/getPoi/index.js` 语法通过（或 IDE 无语法错误）。

### Step 3 — 改写 `exports.main` 为自适应翻页
- [ ] 新增常量 `MAX_PAGES = 4`。
- [ ] 请求第 1 页，校验 `status === '1'`，读取 `count`。
- [ ] `pagesNeeded = min(MAX_PAGES, ceil(count / PAGE_SIZE))`；`> 1` 时 `Promise.all` 并行拉第 2..N 页，每页 `.catch(() => null)`。
- [ ] 聚合 `allPois`（追加页 `status==='1' && pois` 才并入）。
- **验证**：`node -c` 通过。

### Step 4 — 去重 + 标准化 + 排序
- [ ] 按 `${location}|${name}` 复合键 `Set` 去重。
- [ ] `.map(normalizePoi)`（复用现有函数）。
- [ ] `.sort((a,b) => (a.distance||0)-(b.distance||0))`。
- [ ] 返回 `{ status: 'ok', pois }`（结构不变）。
- **验证**：`node -c` 通过；逻辑 review 对照 design.md §2.5。

### Step 5 — 本地静态自测（无云环境时的最小验证）
- [ ] `node -c cloudfunctions/getPoi/index.js`（语法）。
- [ ] 人工 review 关键不变量：
  - 第一页失败 → 返回 `status:'error'`。
  - 追加页失败 → 不抛错、返回部分结果 `status:'ok'`。
  - `count<=25` → 只一次请求。
  - 输出仍是 `{ status, pois }`，POI 字段不变。
- **验证**：以上 4 条逐条确认。

### Step 6 — 部署 + 端到端实测（开发者工具 / 真机）
> 这一步需要你在微信开发者工具里操作（我无法在此环境部署云函数 / 跑真机）。

- [ ] 上传部署 `getPoi` 云函数（右键 → 上传并部署：云端安装依赖）。
- [ ] 确认云开发控制台该函数超时 = 20s（若 `config.json` 未生效，手动在控制台改）。
- [ ] **CBD 场景**：选一个密集商圈位置授权定位 → 观察 `getPoi` 返回 > 25 家。
  - 可临时在 `locationHelper.fetchPois` 打 `console.log(pois.length)` 验证。
- [ ] **稀疏场景**：选郊区位置 → 确认只 1 次请求、行为如常。
- [ ] **盲盒页**：CBD 下连开 ≥10 次，确认不重样、池明显变丰富。
- [ ] **AI 页**：CBD 下场景切换 / 换一批，确认推荐正常、无回归。
- [ ] **缓存**：同位置短时间多次进入页面，确认不重复打云函数（5min 缓存生效）。
- **验证**：以上全部通过。

## 验证命令

```bash
# 语法检查（云函数是 Node CommonJS）
node -c cloudfunctions/getPoi/index.js

# 校验 config.json 是合法 JSON
node -e "JSON.parse(require('fs').readFileSync('cloudfunctions/getPoi/config.json'))" && echo OK
```

## Review Gate

- 完成 Step 1-5（代码 + 静态自测）后，**暂停**，请用户 review `index.js` 改动。
- 用户确认后再做 Step 6（部署 + 端到端实测，需用户在开发者工具操作）。

## 回滚点

- 任何阶段出问题：`git checkout -- cloudfunctions/getPoi/` 恢复，重新部署旧版云函数即可。无数据库迁移、无前端 Breaking，回滚零风险。

## 注意事项

- AMAP_KEY 来自云函数环境变量（`process.env.AMAP_KEY`），本地 `node -c` 不触发实际请求，无需 key。
- 真正的功能验证依赖 Step 6 的云端部署 + 实测，无法在本地完整闭环。
