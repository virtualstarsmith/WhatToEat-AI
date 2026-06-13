# Implementation Plan — WhatToEat-AI MVP

> 配套 `prd.md` 与 `design.md`。本文是执行清单与验收命令，不重复设计依据。
> 实施粒度：**3 阶段递交**，每阶段独立可验。

## Phase Overview

| Stage | 目标 | 关键交付 | 阻塞？ |
|---|---|---|---|
| **S1** 主题与脚手架 | 切换暖橙色主题 + 移除 logs + 接入云开发初始化 | `app.js` / `app.json` / `app.wxss` / `project.config.json` / 删除 `pages/logs/` | 否 |
| **S2** 云函数 | 实现 `getPoi`、`recommend`（含 GLM 与兜底） | `cloudfunctions/getPoi/` `cloudfunctions/recommend/` `config/commercial.js` | 否 |
| **S3** 首页重写 | `pages/index` 三件套全量重写，串接定位→云函数→展示→换一批 | `pages/index/index.{js,wxml,wxss,json}` | 是（依赖 S1 主题 + S2 云函数） |

每阶段交付后单独验证，不通过则当阶段回滚（详见各阶段 Rollback）。

---

## S1 · 主题与脚手架

### 目的
让小程序具备云开发能力 + 暖橙主题，与设计参考图对齐。本阶段不涉及业务逻辑。

### 影响文件

| 文件 | 操作 | 关键变更 |
|---|---|---|
| `app.js` | 重写 | 移除 `globalData.selectedTaste`；移除 logs 写入；新增 `wx.cloud.init({ env: 'TODO-replace', traceUser: true })` |
| `app.json` | 改 | `pages` 只留 `pages/index/index`；`navigationBarBackgroundColor` `#1f7a5a` → `#FF6B35`；`backgroundColor` `#f6f7f4` → `#FFF8F3`；`navigationBarTitleText` → `今天吃什么` |
| `app.wxss` | 改 | `page` 背景 `#f6f7f4` → `#FFF8F3`；主文字 `#1c2823` → `#2B2118`；`.section-title` 次色 `#5b6b62` → `#8A7968` |
| `project.config.json` | 改 | 新增 `"cloudfunctionRoot": "cloudfunctions/"`；`nodeModules` 由 `false` 改为 `true`（云函数装依赖必备） |
| `pages/logs/` | 删除 | 整个目录（4 个文件） |
| `sitemap.json` | 检查 | 若包含 `pages/logs/logs` 引用则移除 |
| `cloudfunctions/` | 新建目录 | 占位空目录（S2 落函数） |
| `config/` | 新建目录 | 占位（S2 落 `commercial.js`） |

### 步骤

1. 修改 `app.json`：替换 `pages` 数组、`window` 颜色与标题
2. 修改 `app.wxss`：替换三处颜色变量
3. 重写 `app.js`：保留 `App({...})` 结构，去掉 logs/globalData.selectedTaste，加 `wx.cloud.init`
4. 修改 `project.config.json`：加 `cloudfunctionRoot`、改 `nodeModules`
5. 检查并清理 `sitemap.json` 中 logs 引用
6. 删除 `pages/logs/` 整个目录
7. 创建空目录 `cloudfunctions/` 与 `config/`（用 `.gitkeep` 占位）

### 关键决策点
- **env ID**：`app.js` 里写占位 `'your-env-id'` + 显眼 TODO 注释，部署时由用户在云开发控制台拿到真实 env 后替换。**implement 阶段不替换**，避免泄露
- **navigationBarTextStyle**：保持 `white`（在 `#FF6B35` 暖橙上对比度足够）

### 验证（用户在微信开发者工具中执行）

| 验证项 | 方式 |
|---|---|
| 编译通过 | 打开微信开发者工具，点击「编译」，无报错 |
| 主题色生效 | 顶栏暖橙、首页背景暖白、标题为"今天吃什么" |
| 云开发初始化 | 工具 → 云开发面板可打开（前提是已在控制台开通云环境并替换 env ID） |
| logs 已移除 | 项目目录树不再有 `pages/logs/`，编译不报"未找到页面"错误 |
| 已有首页仍可访问 | `pages/index` 在 S3 重写前可能展示旧 mock UI，但不应报错 |

### Rollback

- `git checkout app.js app.json app.wxss project.config.json`
- `git checkout pages/logs/` 恢复目录
- 删除新建的 `cloudfunctions/` `config/` 空目录

---

## S2 · 云函数（getPoi + recommend）

### 目的
把高德 POI 接口与 GLM 推荐封装在云函数中，前端零密钥。同时落地手动商业化配置。

### 影响文件

| 文件 | 操作 | 关键内容 |
|---|---|---|
| `cloudfunctions/getPoi/index.js` | 新建 | 用 Node 内置 `https` 调用 `https://restapi.amap.com/v3/place/around`；输入 `{longitude, latitude, radius}`；输出标准化 `{pois: [...], status}` |
| `cloudfunctions/getPoi/package.json` | 新建 | `dependencies`: `wx-server-sdk`（最新） |
| `cloudfunctions/recommend/index.js` | 新建 | 规则评分（design.md §5）→ top 15 → GLM 调用（`response_format: json_object`）→ 校验 `poi_id` 合法性 → 兜底；输入 `{pois, scene, excludeIds}`；输出 `{recommendations, source}` |
| `cloudfunctions/recommend/package.json` | 新建 | `dependencies`: `wx-server-sdk` |
| `config/commercial.js` | 新建 | `module.exports = { entries: [{match, url}, ...] }`；MVP 留示例 + 注释 |
| `cloudfunctions/.gitignore` | 新建 | 忽略 `node_modules/` |

### 步骤

1. 在 `cloudfunctions/getPoi/` 写 `index.js` 和 `package.json`
2. 在 `cloudfunctions/recommend/` 写 `index.js` 和 `package.json`
3. 在 `recommend/index.js` 中实现：
   - `SCENE_KEYWORDS` 常量（照搬 design.md §5.3 词表，含早餐/午餐/下午茶/晚餐/夜宵/随便吃点）
   - `scoreCandidates(pois, scene, excludeIds)` 函数
   - `callGlm(scene, candidates)` 函数（8 秒超时；解析 JSON；校验 `poi_id` 必须在候选集中）
   - 主 handler 流程：评分 → 取 top 15 → GLM → 失败/异常走规则 top 3 兜底
4. 写 `config/commercial.js`，提供 1-2 条示例 + 详细注释
5. 写 `cloudfunctions/.gitignore`（避免 commit `node_modules/`）

### 关键决策点

- **HTTP 客户端**：用 Node 内置 `https`，不引入 axios/got，控制冷启动体积（设计已明确）
- **GLM 超时**：8 秒；超时即走兜底，不重试（避免雪崩）
- **温度**：`temperature: 0.7`（确认 design 设定）
- **场景关键词匹配**：用 `String.prototype.includes` 对商家 `name`/`type` 做扫描；任一关键词命中即视为场景匹配
- **`excludeIds` 降权**：在 `final_score` 上乘 `0.6`，不直接过滤（候选不足时仍能复用）
- **`poi_id` 类型**：`String(index)`（索引转字符串）；GLM 输出非法 id 时丢弃该条而非整批失败

### 验证（用户在微信开发者工具中执行）

部署：在云开发面板右键各云函数 → 上传并部署（云端安装依赖）。

| 验证项 | 方式 |
|---|---|
| 环境变量已设 | 控制台云函数 → 配置 → 检查 `AMAP_KEY` / `GLM_API_KEY` / `GLM_MODEL` 三个变量 |
| `getPoi` 通 | 控制台「测试」标签输入 `{longitude: 116.481, latitude: 39.99, radius: 2000}`；返回 `pois` 数组非空 |
| `recommend` GLM 路径通 | 用 `getPoi` 的输出作 `pois`，加 `{scene: '午餐'}` 调用；返回 `source: 'ai'` 且推荐 1-3 家 |
| `recommend` 兜底路径通 | 临时把 `GLM_API_KEY` 改为非法值，再测；返回 `source: 'fallback'` 且推荐 3 家 |
| `poi_id` 校验生效 | 看日志确认非法 poi_id 被丢弃，handler 不抛 |

### Rollback

- 删除 `cloudfunctions/getPoi/` `cloudfunctions/recommend/` `config/` 目录
- 在云开发控制台手动删除已部署的云函数（用户操作）
- 环境变量保留无影响

---

## S3 · pages/index 重写

### 目的
首页完全重写为「定位 → 场景选择 → 推荐卡片 → 换一批」单页流，串接 S2 的云函数。

### 影响文件

| 文件 | 操作 | 关键内容 |
|---|---|---|
| `pages/index/index.js` | 完全重写 | data: `{location, scene, pois, recommendations, source, loading, error, excludeIds}`；method: `onLoad`/`onShow`、`requestLocation`、`detectScene`、`switchScene`、`loadPois`、`callRecommend`、`refresh`（换一批）、`openNav`、`copyAddr`、`getCommercialUrl` |
| `pages/index/index.wxml` | 完全重写 | 位置栏 / 6 选项场景分段控制器（横向滚动）/ 推荐卡片列表 / 换一批按钮 / 错误状态 / 兜底提示条 |
| `pages/index/index.wxss` | 完全重写 | 暖橙主题；卡片圆角阴影；分段控制器横向滚动；明确状态层叠 |
| `pages/index/index.json` | 改 | `navigationBarTitleText: '今天吃什么'`（如已在 app.json 设全局可不重设） |
| `pages/index/index.json` | 不删除 | 保留以备页面级配置 |

### 步骤

1. 写 `index.wxml`：自上而下骨架（位置栏 / 场景栏 / 卡片列表 / 换一批 / 状态层）
2. 写 `index.wxss`：实现 design.md §9 的主题色与 §7 布局
3. 重写 `index.js`：
   - `onLoad`：调 `detectScene()` 自动填场景，调 `requestLocation()`
   - `requestLocation`：`wx.getLocation({ type: 'gcj02' })`；失败展示降级提示
   - `detectScene`：按 §5.4 时段表给默认场景
   - `switchScene(e)`：手动切换；触发重新推荐
   - `loadPois`：`wx.cloud.callFunction({name: 'getPoi', data: {...}})`
   - `callRecommend`：`wx.cloud.callFunction({name: 'recommend', data: {pois, scene, excludeIds}})`；展示推荐
   - `refresh`：把当前 `recommendations` 的 `poi_id` 推入 `excludeIds`，重新走 `callRecommend`
   - `openNav`：`wx.openLocation({...})`
   - `copyAddr`：`wx.setClipboardData({...})`
   - `getCommercialUrl`：根据商家名按 `config/commercial.js` 的 `match` 关键词找 url（找不到返回空）
4. 在 `index.js` 顶部 `require('../../config/commercial.js')` 引入配置

### 关键决策点

- **场景默认值**：进入页面 `onLoad` 时自动检测；如果用户改过且无新 onShow 触发，保留用户选择
- **`excludeIds` 持久化**：MVP 用 `wx.getStorageSync('excludeIds')` 临时存当轮，刷新页面清空（design.md §13 已说明是临时方案）
- **横向滚动场景栏**：用 `<scroll-view scroll-x>`，6 个选项均匀间距 + 选中态阴影
- **空状态文案**：参考 design.md §7.4 的四种降级状态分别实现
- **商业化入口位置**：卡片底部右下，灰按钮（避免压过"导航"主操作）

### 验证（用户在微信开发者工具中执行）

| 验证项 | 方式 |
|---|---|
| 定位成功路径 | 模拟器允许定位 → 首页展示推荐卡片，至少 1 家，最多 3 家 |
| 定位拒绝路径 | 模拟器拒绝定位 → 展示"需要定位..."+ "重新授权"按钮 |
| 场景自动检测 | 调整工具时间，观察首次进入时高亮场景与时段匹配 |
| 场景切换 | 切换 6 个场景，推荐列表相应变化 |
| 换一批不重复 | 连续点 2 次"换一批"，前两批商家无重叠（候选足够时） |
| 导航 | 点击卡片"导航"，唤起地图 |
| 复制地址 | 点击"复制地址"，toast 提示，剪贴板可粘贴 |
| 兜底提示 | 制造 GLM 失败（S2 已验证），首页顶部显示"智能推荐暂不可用..."提示 |
| 商业化入口 | 在 `config/commercial.js` 加一条匹配某个高德常见连锁店（如"麦当劳"），看是否展示 |

### Rollback

- `git checkout pages/index/`
- 保留 S1/S2 的云函数和主题（不连带回滚）

---

## 全局风险与缓解

| 风险 | 缓解 |
|---|---|
| 高德 / GLM 配额超限 | 云函数日志输出请求量；MVP 暂不加缓存（避免过早优化），监控为主 |
| 云函数冷启动慢 | 不引入大依赖；首次加载在前端展示 loading 态 |
| GLM 模型变更导致 JSON 输出格式漂移 | `response_format: json_object` 强约束 + 输出校验 + 校验失败走兜底 |
| 商家品类关键词漏匹配 | `scene_multiplier` 用 0.5 软降权（非 0），仍能进入候选 |
| 用户拒绝定位 | UI 给明确提示与"重新授权"，不阻塞 |

## 实施完成后的步骤（不在本 implement 范围）

- 用户在微信云开发控制台开通环境、拿到 env ID 替换 `app.js`
- 用户在控制台设置 `AMAP_KEY` / `GLM_API_KEY` / `GLM_MODEL`
- 用户在工具中右键各云函数「上传并部署」
- 用户在 `config/commercial.js` 填入实际商业化链接

## Out of Scope（确认不做）

- 转盘 / 翻卡片 / 自定义菜单页面
- 个人中心 / 偏好设置
- 减脂模式偏好（移至后续，已记入 design.md §13）
- 聚餐场景（移至后续）
- 食材选择页
- 埋点 / 分析
- CPS 自动对账

---

## 验收命令汇总

> 由于本项目是微信小程序，**没有 CLI 可跑的单测**。验收依赖微信开发者工具 + 云开发控制台的手动操作。

| 阶段 | 验收形式 |
|---|---|
| S1 | 工具编译通过 + 视觉一致性检查 |
| S2 | 云函数控制台「测试」标签按输入样例调用，比对输出契约（design.md §3） |
| S3 | 全流程冒烟：定位 → 场景 → 推荐 → 换一批 → 导航 / 复制 |
