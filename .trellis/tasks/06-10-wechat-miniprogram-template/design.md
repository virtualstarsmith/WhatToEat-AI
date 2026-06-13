# design-placeholder
# WhatToEat-AI MVP 技术设计文档

> 对应 PRD：`.trellis/tasks/06-10-wechat-miniprogram-template/prd.md`
> 设计参考图：`参考图片/`（8 张，暖橙/暖红色调、卡片式餐饮推荐 UI）

## 1. 架构概览

微信小程序原生框架 + 微信云开发云函数 + 高德地图 API + GLM 大模型。

核心原则：**前端无密钥**。高德 Key 与 GLM API Key 只存在于云函数环境变量中，小程序前端通过 `wx.cloud.callFunction` 间接调用。

数据流：

```
小程序前端
  | wx.getLocation 获取经纬度
  +-- callFunction('getPoi') --> 云函数 getPoi --> 高德 POI 接口 --> 附近餐饮商家列表
  +-- callFunction('recommend') --> 云函数 recommend
                                    +-- 规则评分预筛选 top 15
                                    +-- 调用 GLM 结构化 JSON 输出
                                    +-- 失败兜底规则 top 3
                                  --> 1-3 家推荐 + 理由
```

## 2. 目录结构（改动范围）

```
WhatToEat-AI/
+- app.js                          # 改：增加 wx.cloud.init
+- app.json                        # 改：主题色、移除 logs 页面
+- app.wxss                        # 改：全局主题色
+- config/
|   +- commercial.js               # 新：手动商业化链接配置
+- cloudfunctions/
|   +- getPoi/
|   |   +- index.js                # 新：代理高德 POI
|   |   +- package.json            # 新：wx-server-sdk 依赖
|   +- recommend/
|       +- index.js                # 新：规则评分 + GLM 调用 + 兜底
|       +- package.json            # 新：wx-server-sdk 依赖
+- pages/
|   +- index/
|       +- index.js                # 改：完全重写（移除 mock mealPool）
|       +- index.wxml              # 改：完全重写
|       +- index.wxss              # 改：完全重写
+- utils/
|   +- util.js                     # 保留：formatTime、pickRandom
+- project.config.json             # 保留：appid、urlCheck false
```

### 删除项

- `pages/logs/`（日志页面，MVP 单页面）

## 3. 数据契约

### 3.1 高德 POI 接口

```
GET https://restapi.amap.com/v3/place/around
  ?location={lng},{lat}
  &types=050000
  &radius=2000
  &key={AMAP_KEY}
  &extensions=base
  &offset=25
```

- `types=050000`：餐饮服务大类
- `radius=2000`：默认 2 公里，前端可调参数
- `offset=25`：一次取 25 条结果（足够规则筛选 top 15）

### 3.2 高德返回字段（getPoi 云函数映射后）

```json
{
  "pois": [
    {
      "name": "商家名称",
      "address": "地址",
      "location": "116.481181,39.990074",
      "distance": 320,
      "typecode": "050301",
      "business": {
        "rating": "4.5",
        "cost": "35"
      }
    }
  ]
}
```

- `distance`：单位米，由高德计算返回
- `business.rating` / `business.cost`：部分商家可能为空，需做空值处理

### 3.3 GLM 输入（recommend 云函数 -> GLM）

```json
{
  "scene": "午餐",
  "candidates": [
    {
      "poi_id": "0",
      "name": "某某快餐",
      "type": "中式快餐",
      "distance": 280,
      "rating": 4.3,
      "cost": 25
    }
  ]
}
```

- `poi_id` 为候选集索引（字符串），映射回原始 POI 数据
- 候选集上限：**top 15**

### 3.4 GLM 输出

```json
{
  "recommendations": [
    { "poi_id": "0", "reason": "距离最近、评分高，适合工作日快速解决午餐。" },
    { "poi_id": "3", "reason": "评分 4.8，口碑最好，性价比突出。" }
  ]
}
```

- `poi_id` 必须来自候选集
- 推荐数量 1-3 家
- 云函数必须校验 poi_id 合法性，非法则丢弃该条

### 3.5 GLM API 调用

兼容 OpenAI Chat Completions 格式：

```
POST https://open.bigmodel.cn/api/coding/paas/v4/chat/completions
Authorization: Bearer {GLM_API_KEY}
Content-Type: application/json

{
  "model": "glm-4.7",
  "messages": [
    { "role": "system", "content": "你是餐饮推荐助手，根据用户用餐场景和附近商家信息，推荐 1-3 家。必须严格返回 JSON。" },
    { "role": "user", "content": "{候选集 + 场景的 JSON 字符串}" }
  ],
  "response_format": { "type": "json_object" },
  "temperature": 0.7
}
```

- 模型名来自环境变量 `GLM_MODEL`，默认 `glm-4.7`
- 使用 `response_format: json_object` 强制 JSON 输出

## 4. 云函数架构

### 4.1 环境变量（仅在云开发控制台设置）

变量名说明：

- `AMAP_KEY`：高德 Web 服务 API Key
- `GLM_API_KEY`：GLM 平台 API Key
- `GLM_MODEL`：模型名，默认 `glm-4.7`

### 4.2 getPoi 云函数

```
输入: { longitude, latitude, radius }
处理: 调用高德 /place/around，解析 pois
输出: { pois: [标准化商家对象], status: 'ok' | 'error' }
```

### 4.3 recommend 云函数

```
输入: { pois, scene, excludeIds }
处理:
  1. 对 pois 规则评分 + 降权
  2. 取 top 15 作为候选集
  3. 调用 GLM
  4. 校验输出，映射回原始 POI
  5. 失败兜底
输出: { recommendations: [...], source: 'ai' | 'fallback' }
```

### 4.4 技术约束

- Node.js 运行时，无额外 npm 依赖（GLM 调用用内置 `https`）
- 云函数通过 `wx-server-sdk` 导出 handler
- 请求超时：GLM 调用设置 8 秒超时，超时即走兜底

## 5. 规则评分详情

### 5.1 行业实践参考

参考美团、大众点评、京东推荐系统的特征工程实践：

- 美团：距离特征使用指数衰减模型（非线性），评分特征使用贝叶斯平滑消除"少评价高分"偏差，场景/类目特征做乘性门控——硬约束场景下不匹配品类大幅降权而非加零分
- 大众点评：必吃榜和星级体系使用 Wilson 区间下界评分，避免低评价数商家的评分虚高
- 京东推荐：热度特征带时间衰减，近期数据权重更高，质量与评价数做交互而非简单相加

本规则仅用于候选预筛选（从高德结果中选 top 15 传入大模型），最终排序由大模型完成。目标是"不遗漏优质商家"，而非精确排序。

### 5.2 评分公式（优化版）

采用两层结构：基础分 x 场景乘子。

    base_score = 0.50 * distance_score + 0.50 * quality_score
    final_score = base_score * scene_multiplier

scene_multiplier 取值：

- 1.0：场景匹配，或用户选"随便吃点"
- 0.5：场景不匹配（用户已明确选了场景）

相比原始线性加法（0.40 distance + 0.35 rating + 0.25 scene）的三个核心改进：

1. 乘性门控：场景不匹配时整体乘 0.5 而非仅加 0 分，防止"距离极近、评分极高但品类不匹配"的商家靠基础分优势挤掉匹配场景的商家
2. 指数衰减距离：符合人类对步行距离的非线性感知
3. 缺失评分降权：无评分商家给 0.3 而非中位数 0.5，避免无评分商家因"不扣分"而虚高

### 5.3 各维度详解

**distance_score（指数衰减）**

    distance_score = exp(-distance / 800)

衰减常数 800m（约 10 分钟步行距离）的得分曲线：

- 0m -> 1.00，200m -> 0.78，500m -> 0.54，800m -> 0.37，1200m -> 0.22，2000m -> 0.08

相比线性归一化（1 - distance/2000），近距离商家优势更显著，远距离商家不会因几百米差异而分数接近。

**quality_score（评分 + 置信处理）**

    quality_score = rating ? (rating / 5.0) : 0.3

- 有评分：直接归一化
- 无评分：给 0.3 而非中位数 0.5。美团和大众点评均倾向降权无评分商家——无评分通常意味着新店或低活跃度
- 后续增强：若高德返回评价数 n，可升级为贝叶斯平滑 adjusted = (C * m + n * avg) / (C + n)，消除"3 条评价全 5 星"的虚高

**scene_multiplier（乘性门控）**

场景与品类关键词匹配，匹配则乘 1.0，不匹配则乘 0.5：

- 早餐（5-10h）：早餐、包子、粥、豆浆、油条、肠粉、面、粉
- 午餐（10-14h）：快餐、简餐、面食、粉、便当、盖饭
- 下午茶/饮品（14-17h）：奶茶、咖啡、甜品、烘焙、果汁、茶饮、轻食
- 晚餐（17-21h）：正餐、火锅、烧烤、炒菜、饭店
- 夜宵（21h - 次日 5h）：烧烤、小龙虾、粥、串、烤、宵夜
- 随便吃点（手动兜底）：全部等权（multiplier = 1.0）

> "减脂"已从场景体系移除，改作独立偏好筛选（详见 §13）。原因：减脂是用户的长期偏好属性，不应与"午餐/晚餐"等时段场景在同一维度并列，会造成"既要减脂又要吃午餐"无法表达的语义冲突。

乘 0.5 而非乘 0：保留品类识别容错（高德 typecode 较粗可能误判），且大模型做最终决策。0.5 而非更低值：非匹配商家仍有机会进入 top 15 候选，避免因高德品类标注粗略而误杀优质商家。

### 5.4 场景自动检测

```
const hour = new Date().getHours();
if (hour >= 5 && hour < 10) scene = '早餐';
else if (hour >= 10 && hour < 14) scene = '午餐';
else if (hour >= 14 && hour < 17) scene = '下午茶/饮品';
else if (hour >= 17 && hour < 21) scene = '晚餐';
else scene = '夜宵'; // 21h - 次日 5h
```

5 个时段场景已覆盖完整 24 小时，"随便吃点"不再作为时段兜底，仅作为手动选项（用户希望放弃场景约束时使用）。

用户进入首页时自动填充默认场景，用户可手动切换为任意场景或"随便吃点"。

### 5.5 换一批降权

- 本地 Storage 记录最近一轮已展示的 poi_id 列表
- 换一批时，将这些 poi_id 的 final_score 乘以 0.6
- 降权后重新排序、取 top 15 调用 GLM
- 候选不足时允许重复，提示"附近可选商家较少"

## 6. 兜底流程

```
recommend 云函数
  |
  +-- GLM 调用成功且输出合法
  |    +-- source: 'ai'，展示推荐理由
  |
  +-- GLM 失败 / 超时 / 输出解析异常 / poi_id 非法
       +-- 取规则评分 top 3
            source: 'fallback'
            前端展示提示："智能推荐暂不可用，已为你按距离和评分筛选"
            兜底结果不展示推荐理由
```

兜底是行业最佳实践中"AI 降级"模式：保留核心功能（推荐），用规则引擎承接，避免用户面对空状态或报错。

## 7. 前端页面设计

### 7.1 单页结构（pages/index）

自上而下：位置栏（当前位置 + 刷新按钮）-> 场景选择（横向滚动分段控制器：早餐 / 午餐 / 下午茶 / 晚餐 / 夜宵 / 随便吃点）-> 推荐卡片 1-3 张 -> 换一批按钮。

场景为 6 选项：5 个时段场景（早餐 / 午餐 / 下午茶 / 晚餐 / 夜宵）+ 1 个手动兜底（随便吃点）。由于宽度受限，分段控制器采用横向滚动布局，默认根据当前时段高亮一个并居中。"下午茶/饮品"在 UI 上简称"下午茶"以节省宽度，但在传给 GLM 的 `scene` 字段中保持完整名"下午茶/饮品"。

### 7.2 卡片字段

每张推荐卡片展示：商家名称、品类标签、距离、人均价格、评分、推荐理由（兜底时隐藏）、导航按钮、复制地址按钮、商业化入口（如有配置）。

### 7.3 交互能力映射

- 获取定位：`wx.getLocation`
- 地图导航：`wx.openLocation`
- 复制地址：`wx.setClipboardData`
- 推荐历史（换一批降权）：`wx.getStorageSync` / `wx.setStorageSync`
- 调用云函数：`wx.cloud.callFunction`

### 7.4 降级状态

- 定位拒绝：展示"需要定位才能推荐附近商家"，附带"重新授权"按钮
- 高德失败：展示"获取附近商家失败"，附带"重试"按钮
- GLM 兜底：正常展示 top 3 卡片 + 顶部提示条
- 候选不足：正常展示，提示"附近可选商家较少"

## 8. 商业化入口配置

`config/commercial.js` 导出配置对象：

```js
module.exports = {
  entries: [
    { match: '麦当劳', url: 'https://...' },
    { match: '肯德基', url: 'https://...' }
  ]
};
```

- `match` 为商家名称关键词匹配，`url` 为推广链接
- MVP 仅手动配置，不对接 CPS
- 推荐排序不受商业化入口影响
- 不做点击记录、不做成交回传

## 9. 主题色变更

现有主题为绿色（`#1f7a5a`），与设计参考图的暖色调不符。MVP 切换为暖橙色调：

- 主色（导航栏、按钮）：`#1f7a5a` -> `#FF6B35`
- 页面背景：`#f6f7f4` -> `#FFF8F3`
- 主文字：`#1c2823` -> `#2B2118`
- 卡片背景：`#edf3ed` -> `#FFFFFF`
- 次要文字：`#5b6b62` -> `#8A7968`

## 10. app.js 变更

现有 `app.js` 无云开发初始化，仅存日志。改为：

```js
App({
  onLaunch() {
    wx.cloud.init({
      env: 'your-env-id',
      traceUser: true
    });
  }
});
```

- 移除 `globalData.selectedTaste`（场景由前端页面状态管理）
- `env` 值部署时替换为实际云环境 ID

## 11. app.json 变更

- `pages` 只保留 `pages/index/index`，移除 `pages/logs/logs`
- `navigationBarBackgroundColor`：`#1f7a5a` -> `#FF6B35`
- `backgroundColor`：`#f6f7f4` -> `#FFF8F3`
- `navigationBarTitleText`：`WhatToEat AI` -> `今天吃什么`

## 12. 现有代码处理

### 12.1 完全重写

- `pages/index/index.js`：移除 mock `mealPool` 和 `pickRandom` 逻辑，替换为云函数调用 + 真实推荐流程
- `pages/index/index.wxml`：完全重写为定位 + 场景 + 卡片布局
- `pages/index/index.wxss`：完全重写为暖橙色卡片主题

### 12.2 保留复用

- `utils/util.js`：`formatTime`、`pickRandom` 保留（pickRandom 可用于换一批的随机扰动）
- `project.config.json`：appid、urlCheck 等配置保持不变

## 13. 后续迁移备注（MVP 临时方案）

- 本地 Storage（推荐历史 / 换一批降权）是临时方案，后续需迁移到云端数据库，支持跨设备、持久化。不应被当作永久方案。
- 无埋点 / 分析系统：MVP 不做，后续根据运营需求补充。
- 商业化入口手动配置：后续可对接 CPS 平台。
- GLM 模型灰度：MVP 保留 `GLM_MODEL` 环境变量切换能力，后续做 A/B 对照。
- 减脂模式（独立偏好）：从场景体系移出，MVP 不进入；后续作为偏好筛选项接入（参考 PRD FR-11 偏好设置），与 §5.3 `scene_multiplier` 正交：开启后在规则评分阶段对"轻食、沙拉、素、健康"品类乘上额外加权（如 1.3），不替换原场景乘子。
- 聚餐场景：本期不进 MVP（决策：MVP 聚焦个人用餐高频场景），后续可作为独立场景或筛选项追加。

## 14. 验收要点（云函数链路）

验收项及方式：

- getPoi 云函数代理高德成功返回 POI：云函数日志 / 前端联调
- recommend 云函数调用 GLM 返回结构化 JSON：云函数日志 / 前端联调
- GLM 失败时规则评分兜底正常工作：手动制造 GLM 超时 / 断 key
- poi_id 校验非法 ID 被丢弃：日志检查
- 换一批降权生效：连续换两批观察重复率
- 推荐结果 1-3 家：前端展示
- 商业化入口不强制置顶：对比有无配置时排序是否一致
