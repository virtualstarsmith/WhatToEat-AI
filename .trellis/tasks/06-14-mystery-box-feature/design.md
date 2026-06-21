# 盲盒推荐功能 - 技术设计

## 1. 架构概览

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    pages/index/index                     │
│  ┌──────────────────────────────────────────────────┐   │
│  │              swiper (左右切换容器)                 │   │
│  │  ┌────────────────────┐  ┌────────────────────┐ │   │
│  │  │   左侧：AI推荐      │  │   右侧：盲盒推荐    │ │   │
│  │  │  (现有功能保持不变)  │  │   (新增功能)       │ │   │
│  │  │                    │  │                    │ │   │
│  │  │  - 场景选择         │  │  - 盲盒图标        │ │   │
│  │  │  - AI推荐卡片       │  │  - 开盒动画        │ │   │
│  │  │  - 换一批           │  │  - 结果展示        │ │   │
│  │  │                    │  │  - 历史记录        │ │   │
│  │  └────────────────────┘  └────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │           tab指示器 [AI推荐] [盲盒推荐]            │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          ↓ 共享
┌─────────────────────────────────────────────────────────┐
│              this.data.pois (共享数据源)                 │
│                    ↑                                    │
│              getPoi 云函数（复用）                       │
└─────────────────────────────────────────────────────────┘
```

### 1.2 模块边界

| 模块 | 职责 | 依赖 |
|------|------|------|
| **页面容器** | swiper左右切换、tab指示器 | 无 |
| **AI推荐模块** | 现有功能（场景选择、AI调用、兜底） | pois、GLM API |
| **盲盒推荐模块** | 盲盒UI、开盒动画、历史记录 | pois（只读） |
| **盲盒算法模块** | Epsilon-Greedy算法、质量门槛、去重 | pois、SCENE_KEYWORDS |
| **数据层** | getPoi调用、pois状态管理 | getPoi云函数 |

## 2. 数据流设计

### 2.1 数据流图

```
用户授权位置
     │
     ▼
requestLocation() ──► wx.chooseLocation
     │
     ▼
loadPoisAndRecommend()
     │
     ▼
wx.cloud.callFunction('getPoi')
     │
     ▼
setData({ pois: result.pois })  ◄── 共享数据源
     │
     ├──────────────────┐
     ▼                  ▼
callRecommend(pois)   onOpenMysteryBox()  ◄── 用户点击开盲盒
(AI推荐路径)              │
     │                    ▼
     ▼               runMysteryBoxAlgorithm(pois)
GLM API调用               │
     │                    ▼
     ▼               Epsilon-Greedy决策
推荐结果                   │
                          ▼
                     质量门槛 + 去重 + 加权
                          │
                          ▼
                     选中1家poi
                          │
                          ▼
                     开盒动画 + 展示
```

### 2.2 状态数据结构

新增的 `data` 字段（在现有基础上扩展）：

```javascript
data: {
  // ===== 现有字段（保持不变）=====
  scenes, scene, sceneShort, address, locationOk, locationError,
  pois, recommendations, cardsView, source, excludeIds,
  loading, refreshing, error, coord,
  refreshCount, lastRefreshTime, dailyRefreshLimit, cooldownTime,
  
  // ===== 新增：页面切换 =====
  currentTab: 0,  // 0=AI推荐, 1=盲盒推荐
  
  // ===== 新增：盲盒状态 =====
  mysteryBox: {
    status: 'idle',        // idle | opening | revealed
    currentResult: null,   // 当前开出的餐厅
    history: [],           // 本次会话历史记录 [{poi_id, name, ...}]
    openedIds: [],         // 已开过的poi_id列表（用于去重）
    lastOpenTime: 0,       // 上次开盒时间（用于冷却）
    cooldownTime: 2000,    // 2秒冷却
    poolExhausted: false   // POI池是否耗尽
  }
}
```

## 3. 核心算法设计

### 3.1 Epsilon-Greedy算法实现

```javascript
// utils/mysteryBox.js（新建工具模块）

const { SCENE_KEYWORDS } = require('../config/sceneKeywords'); // 复用

// 距离评分（复用现有逻辑）
function distanceScore(distance) {
  return Math.exp(-distance / 800);
}

// 质量评分（复用现有逻辑）
function qualityScore(rating) {
  return rating ? rating / 5.0 : 0.3;
}

// 长尾加成（新增：非连锁/特色店加权）
function longTailBonus(poi) {
  const chainKeywords = ['麦当劳', '肯德基', '星巴克', '蜜雪冰城', '必胜客', '汉堡王'];
  const isChain = chainKeywords.some(k => (poi.name || '').includes(k));
  return isChain ? 0.3 : 1.0; // 连锁降权，特色店加权
}

// 时段感知加权（新增）
function timeAwareMultiplier(poi, currentScene) {
  const keywords = SCENE_KEYWORDS[currentScene];
  if (!keywords) return 1.0; // 随便吃点等场景不加权
  const haystack = (poi.name || '') + (poi.type || '') + (poi.typecode || '');
  const isMatch = keywords.some(k => haystack.indexOf(k) >= 0);
  return isMatch ? 1.3 : 0.7;
}

// 质量门槛筛选
function qualifyFilter(poi) {
  const hasRating = poi.rating && poi.rating >= 3.5;
  const nearbyNoRating = !poi.rating && poi.distance <= 500;
  return (hasRating || nearbyNoRating) && poi.distance <= 3000;
}

// 计算权重
function calculateWeight(poi, currentScene) {
  const base = 0.4 * distanceScore(poi.distance)
             + 0.4 * qualityScore(poi.rating)
             + 0.2 * longTailBonus(poi);
  return base * timeAwareMultiplier(poi, currentScene);
}

// 加权随机选择
function weightedRandomPick(candidates) {
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let random = Math.random() * totalWeight;
  for (const c of candidates) {
    random -= c.weight;
    if (random <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

// 主算法入口
function mysteryBoxRecommend(pois, openedIds, currentScene) {
  const epsilon = 0.3;
  
  // 1. 质量门槛 + 会话去重
  const openedSet = new Set(openedIds);
  const candidates = pois
    .map((poi, idx) => ({ poi, poi_id: String(idx) }))
    .filter(c => qualifyFilter(c.poi))
    .filter(c => !openedSet.has(c.poi_id));
  
  if (candidates.length === 0) return null; // 池子耗尽
  
  // 2. Epsilon-Greedy决策
  if (Math.random() < epsilon) {
    // 探索：纯随机
    return candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    // 利用：加权随机
    const weighted = candidates.map(c => ({
      ...c,
      weight: calculateWeight(c.poi, currentScene)
    }));
    return weightedRandomPick(weighted);
  }
}
```

> **实现修订（2026-06-20 review）**：上述伪代码在实现落地后有如下调整，以 `utils/mysteryBox.js` 为准：
>
> 1. **poi_id 改用稳定复合键** `location|name`（新增 `makePoiId(poi)`），与云函数 `getPoi/index.js` 的跨页去重键一致。原伪代码用 `String(idx)` 数组下标，池子顺序一旦变化（刷新/翻页/切定位）去重即失效。**约定：盲盒/推荐的 poi_id 必须是稳定唯一标识，禁止用数组下标。**
> 2. **探索分支改为「中段探索」**：按权重升序排序后从 30%~70% 分位的子集随机选（新增 `midBandPick`），而非纯随机。避免 epsilon=0.3 的探索开盒完全无视质量、距离，与"盲盒≠垃圾推荐"的门槛理念冲突。候选 <3 时退化为取较高权重者。
> 3. **连锁降权 0.3 → 0.2**：在 20% 长尾维度上进一步压制连锁，让特色小店更易开出。
> 4. **无评分门槛 500m → 1500m**：原 500m 会误杀郊区/低密度区的特色小店，与 longTailBonus「捧特色小店」意图矛盾。
>
> **遗留观察（✅ 已于 06-21-mystery-scene-tuning 处理）**：`timeAwareMultiplier` 不匹配时 ×0.7 压制较强，且 `SCENE_KEYWORDS` 关键词表覆盖不全（如"面馆"未匹配午餐的"面食"）。已在该任务中：① 系数改为匹配 ×1.2 / 不匹配 ×0.85（弱化惩罚）；② 扩充五场景高频品类词。修复后 150m 面馆权重(1.080) > 800m 肠粉(0.849)，近距好店不再被反超。

### 3.2 推荐理由生成

```javascript
function generateMysteryReason(poi, currentScene) {
  const distance = poi.distance || 0;
  const distanceText = distance >= 1000 
    ? Math.round(distance / 1000) + '公里' 
    : Math.round(distance) + '米';
  const ratingText = poi.rating ? poi.rating.toFixed(1) + '分' : '好评';
  const type = poi.type || '餐饮';
  
  // 检查时段不匹配
  const poiScene = detectPoiScene(poi);
  if (isSceneMismatch(poiScene, currentScene)) {
    return `🌙 盲盒开出${poi.name}（${poiScene}店），当前是${currentScene}时段，注意营业时间`;
  }
  
  // 正常盲盒文案（随机选择）
  const reasons = [
    `🎁 恭喜开出${poi.name}！${ratingText}的好店`,
    `✨ 盲盒惊喜：这家${type}距离仅${distanceText}`,
    `🎲 随机命中！${poi.name}等你来尝鲜`,
    `🍀 今日幸运：${ratingText}的${type}推荐给你`,
    `🎯 盲盒精选：藏在${distanceText}外的宝藏小店`,
    `💫 神秘开箱：${poi.name}，${ratingText}值得一试`
  ];
  return reasons[Math.floor(Math.random() * reasons.length)];
}
```

## 4. UI/交互设计

### 4.1 WXML结构改造

```xml
<view class="page">
  <!-- 位置栏（共享，两个页面都显示） -->
  <view class="loc-bar">...</view>
  
  <!-- Tab指示器 -->
  <view class="tab-bar">
    <view class="tab-item {{currentTab === 0 ? 'active' : ''}}" 
          data-tab="0" bindtap="onSwitchTab">
      🤖 AI推荐
    </view>
    <view class="tab-item {{currentTab === 1 ? 'active' : ''}}" 
          data-tab="1" bindtap="onSwitchTab">
      🎁 盲盒推荐
    </view>
  </view>
  
  <!-- Swiper容器 -->
  <swiper current="{{currentTab}}" bindchange="onSwiperChange" 
          class="page-swiper" duration="300">
    
    <!-- 左侧：AI推荐（现有内容迁移） -->
    <swiper-item>
      <scroll-view scroll-y class="ai-panel">
        <!-- 场景栏、推荐卡片、换一批（现有内容） -->
      </scroll-view>
    </swiper-item>
    
    <!-- 右侧：盲盒推荐（新增） -->
    <swiper-item>
      <scroll-view scroll-y class="mystery-panel">
        <view class="mystery-container">
          <!-- 盲盒主体 -->
          <view class="mystery-box {{mysteryBox.status}}">
            <view class="box-icon" wx:if="{{mysteryBox.status === 'idle'}}">
              🎁
            </view>
            <view class="box-opening" wx:elif="{{mysteryBox.status === 'opening'}}">
              开盒动画...
            </view>
            <view class="box-result" wx:else>
              <!-- 餐厅卡片 -->
            </view>
          </view>
          
          <!-- 开盲盒按钮 -->
          <button bindtap="onOpenMysteryBox" 
                  disabled="{{mysteryBox.status === 'opening'}}">
            {{mysteryBox.status === 'opening' ? '开盒中...' : '🎲 开盲盒'}}
          </button>
          
          <!-- 历史记录 -->
          <view class="history-section" wx:if="{{mysteryBox.history.length > 0}}">
            <text class="history-title">本次开过的盲盒</text>
            <scroll-view scroll-x class="history-list">
              <view wx:for="{{mysteryBox.history}}" wx:key="poi_id" 
                    class="history-item" data-idx="{{index}}" 
                    bindtap="onReopenHistory">
                {{item.name}}
              </view>
            </scroll-view>
          </view>
        </view>
      </scroll-view>
    </swiper-item>
  </swiper>
</view>
```

### 4.2 开盒动画方案

采用 **CSS animation + 阶段切换** 实现（无需Lottie，保持轻量）：

```css
/* 三阶段动画 */
.box-idle {
  animation: float 2s ease-in-out infinite; /* 待机：轻微浮动 */
}
.box-opening {
  animation: shake 0.5s ease-in-out 3, glow 1.5s ease-out; /* 开盒：晃动+发光 */
}
.box-revealed {
  animation: fadeInUp 0.5s ease-out; /* 结果：淡入上滑 */
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10rpx); }
}
@keyframes shake {
  0%, 100% { transform: translateX(0) rotate(0); }
  25% { transform: translateX(-10rpx) rotate(-5deg); }
  75% { transform: translateX(10rpx) rotate(5deg); }
}
@keyframes glow {
  0% { box-shadow: 0 0 0 rgba(255,215,0,0); }
  50% { box-shadow: 0 0 40rpx rgba(255,215,0,0.8); }
  100% { box-shadow: 0 0 0 rgba(255,215,0,0); }
}
```

## 5. 兼容性与迁移

### 5.1 现有代码改动范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `pages/index/index.wxml` | **重构** | 包裹swiper，拆分两个panel |
| `pages/index/index.wxss` | **扩展** | 新增盲盒样式、动画 |
| `pages/index/index.js` | **扩展** | 新增盲盒相关data和methods |
| `utils/mysteryBox.js` | **新建** | 盲盒算法工具模块 |
| `cloudfunctions/*` | **不变** | 无需改动云函数 |

### 5.2 向后兼容

- 现有AI推荐功能完全保留，逻辑不变
- `getPoi` 云函数无改动
- `recommend` 云函数无改动
- 现有data字段保留，新增字段独立命名空间（mysteryBox对象）

### 5.3 风险点

1. **swiper高度问题**：swiper需要固定高度，需计算屏幕高度减去loc-bar和tab-bar
2. **动画性能**：CSS动画在小程序中性能良好，避免JS频繁操作DOM
3. **状态同步**：切换tab时确保两个页面的loading状态独立

## 6. 关键权衡

### 6.1 为何用swiper而非自定义切换
- swiper是小程序原生组件，性能好
- 自带左右滑动手势，无需额外实现
- current属性可双向绑定，支持点击tab切换

### 6.2 为何算法放utils而非页面内
- 算法逻辑独立，便于单元测试
- 页面代码保持简洁
- 未来可复用到其他场景

### 6.3 为何用CSS动画而非Lottie
- CSS动画体积小，加载快
- 盲盒动画相对简单，CSS足够
- Lottie需要额外引入库，增加包体积

## 7. 运营与回滚

### 7.1 灰度策略
- MVP阶段盲盒功能默认开启
- 如有问题，可通过注释wxml中swiper-item快速回滚到单页面

### 7.2 监控点
- 开盲盒按钮点击率
- 开盒完成率（是否中断动画）
- 历史记录使用率
- POI池耗尽触发频率

### 7.3 回滚方案
- Git revert相关commit即可
- 无数据库迁移，无云函数改动，回滚零风险
