# 盲盒推荐功能 - 实施计划

## 执行顺序总览

```
阶段1：算法模块（无UI依赖，可独立测试）
   ↓
阶段2：数据层扩展（页面data新增字段）
   ↓
阶段3：盲盒页面UI（wxml + wxss）
   ↓
阶段4：页面容器改造（swiper + tab）
   ↓
阶段5：集成与联调
   ↓
阶段6：验收测试
```

## 详细实施清单

### 阶段1：算法模块（utils/mysteryBox.js）

**任务1.1：创建场景关键词配置**
- [ ] 检查现有 `pages/index/index.js` 中的 `SCENE_KEYWORDS`
- [ ] 决策：复用index.js中的定义，或抽取到config
- [ ] **推荐**：抽取到 `config/sceneKeywords.js`，供index.js和mysteryBox.js共享

**任务1.2：创建 utils/mysteryBox.js**
- [ ] 实现距离评分 `distanceScore()`（复用现有公式）
- [ ] 实现质量评分 `qualityScore()`（复用现有公式）
- [ ] 实现长尾加成 `longTailBonus()`（新增：连锁店识别）
- [ ] 实现时段感知加权 `timeAwareMultiplier()`（新增）
- [ ] 实现质量门槛 `qualifyFilter()`（新增）
- [ ] 实现权重计算 `calculateWeight()`（新增）
- [ ] 实现加权随机选择 `weightedRandomPick()`（新增）
- [ ] 实现主算法 `mysteryBoxRecommend()`（新增）
- [ ] 实现推荐理由生成 `generateMysteryReason()`（新增）
- [ ] 实现场景检测辅助函数 `detectPoiScene()`、`isSceneMismatch()`（新增）

**验证：**
```bash
# 在小程序开发者工具控制台手动测试
const mb = require('./utils/mysteryBox.js');
const testPois = [{name:'测试店',rating:4.5,distance:300,type:'餐饮'}, ...];
console.log(mb.mysteryBoxRecommend(testPois, [], '午餐'));
```

### 阶段2：数据层扩展（pages/index/index.js）

**任务2.1：新增data字段**
- [ ] 添加 `currentTab: 0`
- [ ] 添加 `mysteryBox` 对象（status, currentResult, history, openedIds, lastOpenTime, cooldownTime, poolExhausted）

**任务2.2：新增盲盒相关methods**
- [ ] `onSwitchTab(e)` - 点击tab切换
- [ ] `onSwiperChange(e)` - 滑动切换回调
- [ ] `onOpenMysteryBox()` - 开盲盒主入口
- [ ] `_runMysteryBoxAlgorithm()` - 调用算法模块
- [ ] `_playOpenAnimation()` - 播放开盒动画
- [ ] `_addToHistory(poi)` - 添加历史记录
- [ ] `_checkCooldown()` - 冷却检查（复用现有模式）
- [ ] `onReopenHistory(e)` - 点击历史记录重新查看
- [ ] `onMysteryNav(e)` - 盲盒结果导航
- [ ] `onMysteryAgain()` - 再开一次

**任务2.3：修改现有逻辑**
- [ ] `loadPoisAndRecommend()` 成功后，不清空盲盒history（但重置openedIds，因为pois索引变了）
- [ ] `requestLocation()` 重新定位时，重置盲盒状态

### 阶段3：盲盒页面UI

**任务3.1：创建盲盒页面样式（index.wxss新增）**
- [ ] `.mystery-panel` 容器样式
- [ ] `.mystery-container` 居中布局
- [ ] `.mystery-box` 盲盒主体（含idle/opening/revealed状态）
- [ ] `.box-icon` 待机状态的盲盒图标
- [ ] `.box-opening` 开盒动画样式
- [ ] `.box-result` 结果卡片样式
- [ ] 开盲盒按钮样式
- [ ] 历史记录区域样式（`.history-section`, `.history-list`, `.history-item`）
- [ ] CSS动画定义（float, shake, glow, fadeInUp）

**任务3.2：盲盒页面结构（index.wxml新增swiper-item）**
- [ ] 盲盒主体view（根据status切换显示）
- [ ] 开盲盒按钮
- [ ] 历史记录scroll-view（横向滚动）
- [ ] POI池耗尽提示
- [ ] 结果卡片（复用现有card样式，适配盲盒调性）

### 阶段4：页面容器改造

**任务4.1：重构index.wxml为swiper结构**
- [ ] 将现有AI推荐内容包裹进 `<swiper-item>`
- [ ] 添加 `<swiper>` 容器，绑定current和bindchange
- [ ] 添加tab-bar（AI推荐 / 盲盒推荐）
- [ ] 保持位置栏（loc-bar）在swiper外层（共享）

**任务4.2：swiper高度适配**
- [ ] 计算swiper高度：屏幕高度 - loc-bar高度 - tab-bar高度
- [ ] 在onLoad中通过 `wx.getSystemInfo` 获取屏幕尺寸
- [ ] 动态设置swiper高度

**任务4.3：tab样式**
- [ ] tab-bar布局（横向两等分）
- [ ] active状态高亮
- [ ] 平滑过渡动画

### 阶段5：集成与联调

**任务5.1：打通数据流**
- [ ] 确认 `this.data.pois` 在盲盒算法中正确传递
- [ ] 确认位置变化时盲盒状态正确重置
- [ ] 确认两个页面切换不丢失各自状态

**任务5.2：动画与状态同步**
- [ ] 开盒动画期间禁用按钮（防重复点击）
- [ ] 动画结束后正确切换到revealed状态
- [ ] 震动反馈时机（wx.vibrateShort）

**任务5.3：边界情况处理**
- [ ] POI池耗尽时显示提示
- [ ] 未授权位置时盲盒页面提示
- [ ] pois为空时的空状态
- [ ] 网络错误时的处理

### 阶段6：验收测试

**任务6.1：功能验收（对照PRD Acceptance Criteria）**
- [ ] UI/交互验收清单（9项）
- [ ] 算法验收清单（6项）
- [ ] 场景处理验收清单（3项）
- [ ] 数据一致性验收清单（3项）
- [ ] 推荐理由验收清单（3项）

**任务6.2：兼容性测试**
- [ ] 不同屏幕尺寸适配
- [ ] iOS/Android动画一致性
- [ ] 低端机型性能

**任务6.3：回归测试**
- [ ] 现有AI推荐功能正常
- [ ] 现有换一批功能正常
- [ ] 现有场景切换功能正常

## 验证命令

```bash
# 检查文件改动
git status
git diff --stat

# 语法检查（如有eslint）
npx eslint pages/index/index.js utils/mysteryBox.js

# 在微信开发者工具中：
# 1. 编译预览，确认无报错
# 2. 授权位置，测试AI推荐（回归）
# 3. 切换到盲盒页面，测试开盲盒
# 4. 测试历史记录、再开一次
# 5. 测试换位置后两个页面同步
```

## 风险文件与回滚点

| 风险点 | 影响 | 回滚方式 |
|--------|------|---------|
| swiper高度计算错误 | 页面布局错乱 | 固定高度兜底 |
| 算法权重失衡 | 推荐质量差 | 调整权重参数 |
| 动画卡顿 | 体验差 | 简化动画或降级 |
| 现有功能回归失败 | AI推荐不可用 | git revert |

## 关键回滚点

1. **阶段1完成后**：算法模块独立，不影响现有功能
2. **阶段3完成后**：盲盒UI存在但未接入，可单独预览
3. **阶段4完成后**：swiper接入，这是最大改动点，需重点回归测试
4. **阶段5完成后**：完整功能，可全量验收

## 实施前检查（task.py start前）

- [ ] PRD已完整，验收标准明确
- [ ] design.md技术方案已确认
- [ ] 现有代码结构已理解（index.js/wxml/wxss）
- [ ] 复用的函数已确认存在（distanceScore, qualityScore, SCENE_KEYWORDS, detectScene）
- [ ] 测试环境（微信开发者工具）可用
