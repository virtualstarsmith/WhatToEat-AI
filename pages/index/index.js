// 首页：AI 推荐
// 位置与 POI 数据通过 locationHelper + app.globalData 与 mystery 页面共享
// 盲盒逻辑已迁移至 pages/mystery/

const { SCENE_KEYWORDS, SCENES } = require('../../config/sceneKeywords.js');
const locHelper = require('../../utils/locationHelper.js');
const commercialHelper = require('../../utils/commercialHelper.js');
const { normalizePoiType } = require('../../utils/util.js');
const { scoreCandidates: scoreCandidatesBase } = require('../../utils/scoring.js');
const { callAiRecommend } = require('../../utils/aiRecommend.js');

const SCENE_TONE_MAP = {
  '随便吃点': 'tone-warm',
  '早餐': 'tone-value',
  '午餐': 'tone-spicy',
  '晚餐': 'tone-spicy',
  '夜宵': 'tone-late',
  '下午茶/饮品': 'tone-fresh'
};

const SCENE_OPTIONS = SCENES.map((name) => ({
  name,
  label: sceneLabel(name),
  tone: SCENE_TONE_MAP[name] || 'tone-warm'
}));

// 评分相关函数
// distanceScore / qualityScore 已抽到 utils/scoring.js 共享（首页与盲盒同源，见 06-24-scoring-module）。
// 首页评分公式：0.5×距离 + 0.5×质量（求稳，贴近用户当下需求）。
// 注意：盲盒页 utils/mysteryBox.js 用 0.4/0.4/0.2（含长尾惊喜项），
// 两套权重是有意区分的——首页求稳、盲盒求惊喜，并非遗漏。

function sceneMultiplier(scene, poi) {
  const keywords = SCENE_KEYWORDS[scene];
  if (!keywords) return 1.0;
  const haystack = (poi.name || '') + (poi.type || '') + (poi.typecode || '');
  return keywords.some((k) => haystack.indexOf(k) >= 0) ? 1.0 : 0.5;
}

// 首页候选打分：复用 utils/scoring.js 的 scoreCandidates，传入首页专属权重 profile 与场景乘数。
// matcher 用 (poi) => sceneMultiplier(scene, poi) 把场景绑定进去。
// poi_id 用稳定唯一标识（见 06-24-poi-id-stable）；matched 由 scoreCandidatesBase 按 matcher 命中计算。
function scoreCandidates(pois, scene, excludeIds) {
  return scoreCandidatesBase(pois, {
    weights: { d: 0.5, q: 0.5 },
    matcher: (poi) => sceneMultiplier(scene, poi),
    excludeIds
  });
}

function topN(scored, n) {
  return [...scored].sort((a, b) => b.score - a.score).slice(0, n);
}

// 候选多样性选取：预留 exploreSlots 个「探索位」给非场景匹配的高分店铺，
// 避免纯按场景加权分数排序导致 AI 候选全部同质化（如午餐全是面馆快餐）。
// 场景匹配不足时自动用匹配档补齐，保证总能返回 n 个。
function topNWithExplore(scored, n, exploreSlots) {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const matched = sorted.filter((s) => s.matched);
  const others = sorted.filter((s) => !s.matched);
  const mainCount = Math.max(n - exploreSlots, 0);
  const picked = [
    ...matched.slice(0, mainCount),
    ...others.slice(0, exploreSlots)
  ];
  // 探索位不足或匹配档不足时，从剩余候选补齐到 n 个
  if (picked.length < n) {
    const pickedIds = new Set(picked.map((p) => p.poi_id));
    for (const s of sorted) {
      if (picked.length >= n) break;
      if (!pickedIds.has(s.poi_id)) picked.push(s);
    }
  }
  // 交给 AI 前再按分数排序，保持候选顺序稳定
  return picked.sort((a, b) => b.score - a.score);
}

// 按时段自动检测场景
function detectScene() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) return '早餐';
  if (hour >= 10 && hour < 14) return '午餐';
  if (hour >= 14 && hour < 17) return '下午茶/饮品';
  if (hour >= 17 && hour < 21) return '晚餐';
  return '夜宵';
}

// 补零：用于喂给 AI 的时间文本（"08:30" 而非 "8:30"）
function padHour(h) {
  return h < 10 ? '0' + h : '' + h;
}
function padMinute(m) {
  return m < 10 ? '0' + m : '' + m;
}

function sceneLabel(scene) {
  return scene === '下午茶/饮品' ? '下午茶' : scene;
}

function formatDistance(d) {
  if (d == null) return '';
  return d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
}

function formatRating(r) {
  return r ? r.toFixed(1) : '无评分';
}

function buildCardView(rec) {
  const poi = rec.poi || {};
  return {
    poi_id: rec.poi_id,
    name: poi.name || '未知店铺',
    type: normalizePoiType(poi.type),
    address: poi.address || '',
    location: poi.location || '',
    distanceText: formatDistance(poi.distance),
    ratingText: formatRating(poi.rating),
    costText: poi.cost ? '¥' + poi.cost + '/人' : '',
    reason: rec.reason || '',
    shopEntry: !!commercialHelper.lookupShopEntry(poi.name)
  };
}

// parseRecommendJson / tolerantParseRecommendations 已迁出至 utils/aiRecommend.js
// （纯函数、无 wx 依赖，可被测试 require）。见 06-24-ai-recommend。

Page({
  data: {
    sceneOptions: SCENE_OPTIONS,
    scene: '随便吃点',
    sceneShort: '随便吃点',
    address: '',
    locationOk: false,
    locationError: '',
    pois: [],
    recommendations: [],
    cardsView: [],
    platformButtons: [], // 平台级「领红包」入口（onLoad 从 commercialHelper 计算）
    showCouponPicker: false, // 红包选择弹窗显隐
    source: '', // 'ai' | 'fallback' | ''
    excludeIds: [],
    loading: false,
    refreshing: false,
    error: '',
    // 换一批限制
    refreshCount: 0,
    lastRefreshTime: 0,
    dailyRefreshLimit: 20,
    cooldownTime: 2000
  },

  _setScene(scene) {
    this.setData({ scene, sceneShort: sceneLabel(scene) });
  },

  onLoad() {
    this._setScene(detectScene());
    this._checkDailyReset();
    // 平台级推广入口（静态配置派生，算一次即可）
    this.setData({ platformButtons: commercialHelper.getPlatformButtons() });
  },

  onShow() {
    // 从其他 tab 返回时同步全局位置/POI 状态
    locHelper.syncFromGlobal(this);
    // 更新 tabBar 选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    // pois 在本页非活跃期间被更新（如在盲盒页切换了定位）→ 作废旧推荐
    if (locHelper.poisUpdatedSince(this)) {
      locHelper.markPoisConsumed(this);
      this.setData({ excludeIds: [], recommendations: [], cardsView: [], source: '', error: '' });
    }
    // 如果已有 POI 但当前无推荐结果（含上一步清空后），自动触发一次推荐
    if (this.data.locationOk && this.data.pois.length > 0 && this.data.cardsView.length === 0 && !this.data.loading) {
      this.callRecommend(this.data.pois);
    }
  },

  // 检查每日重置
  _checkDailyReset() {
    const today = new Date().toDateString();
    const lastDate = wx.getStorageSync('lastRefreshDate');

    if (lastDate !== today) {
      wx.setStorageSync('lastRefreshDate', today);
      wx.setStorageSync('dailyRefreshCount', 0);
      this.setData({ refreshCount: 0 });
    } else {
      const count = wx.getStorageSync('dailyRefreshCount') || 0;
      this.setData({ refreshCount: count });
    }
  },

  onSelectScene(e) {
    const scene = e.currentTarget.dataset.scene;
    if (!scene || scene === this.data.scene) return;
    // 加载中（首次推荐 / 换一批）禁止切换场景，避免并发请求与状态错乱
    if (this.data.loading || this.data.refreshing) return;
    this._setScene(scene);
    this.setData({
      excludeIds: [],
      recommendations: [],
      cardsView: [],
      source: '',
      error: ''
    });
    if (this.data.locationOk && this.data.pois.length > 0) {
      // callRecommend 自身不设 loading，这里显式置位以驱动 chip 锁定与加载提示
      this.setData({ loading: true });
      this.callRecommend(this.data.pois);
    } else if (this.data.locationOk) {
      this.loadPoisAndRecommend();
    }
  },

  // ===== 位置相关（接入 locationHelper）=====

  requestLocation() {
    this.setData({ loading: true, error: '', locationError: '' });
    locHelper.chooseLocationAndGetPois()
      .then((pois) => {
        locHelper.syncFromGlobal(this);
        return this.callRecommend(pois);
      })
      .catch(() => {
        locHelper.syncFromGlobal(this);
        this.setData({ loading: false });
      });
  },

  refreshLocation() {
    this.requestLocation();
  },

  loadPoisAndRecommend() {
    const g = getApp().globalData;
    if (!g.coord) return;
    this.setData({ loading: true, error: '' });
    locHelper.fetchPois(g.coord)
      .then((pois) => {
        locHelper.syncFromGlobal(this);
        return this.callRecommend(pois);
      })
      .catch((e) => {
        console.error('loadPoisAndRecommend error:', e);
        this.setData({ loading: false, error: '获取附近商家失败，请重试' });
      });
  },

  // ===== AI 推荐 =====

  async callAIRecommend(candidates, scene, candidateMap) {
    try {
      // 构造当前语境：让 AI 的理由"识相"，而非机械复述评分距离。
      // timeText/weekdayText 让模型感知"几点、周几"，据此调整语气
      // （如深夜点口吻收着、午餐点强调速度、周末点放松感）。
      const now = new Date();
      const timeText = `${padHour(now.getHours())}:${padMinute(now.getMinutes())}`;
      const weekdayText = '周' + '日一二三四五六'[now.getDay()];

      const messages = [
        {
          role: 'system',
          content:
            '你是用户身边最懂吃的朋友，不是推荐机器。根据用餐场景、当下时间、候选店的特色，' +
            '从候选列表中挑 1-3 家，并用一句话告诉用户为什么选这家。' +
            '必须严格返回 JSON，格式：{"recommendations":[{"poi_id":"字符串","reason":"一句话理由"}]}。' +
            'poi_id 必须来自候选列表（不可编造）。\n' +
            '理由要求：\n' +
            '- 25 字以内、自然口语化，像朋友随口说的一句，不要"这家店评分X分距离Y米"这种说明书式复述\n' +
            '- 抓住当下语境说话：午餐强调近和快、晚餐强调放松或下馆子、夜宵强调解馋、周末强调犒劳自己\n' +
            '- 突出这家店此刻最值得的一点（近/快/热乎/解馋/换口味/性价比），别面面俱到\n' +
            '- 不要废话开场白（如"推荐""我觉得"）'
        },
        {
          role: 'user',
          content: JSON.stringify({
            scene,
            time: timeText,
            weekday: weekdayText,
            candidates: candidates.map((c) => ({
              poi_id: c.poi_id,
              name: c.poi.name,
              type: c.poi.type,
              distance: c.poi.distance,
              rating: c.poi.rating,
              cost: c.poi.cost
            }))
          })
        }
      ];

      // 流式收集 + 4 层容错解析下沉到 utils/aiRecommend.js（与盲盒页同源，消除双份复制）。
      // candidateMap 业务 join 校验留在 callRecommend（消费侧）。
      const result = await callAiRecommend({ messages });
      if (!result) throw new Error('Empty AI response');
      return result;
    } catch (e) {
      console.error('AI recommend error:', e);
      throw e;
    }
  },

  async callRecommend(pois) {
    // 本次推荐消费了当前 pois 版本，标记以供 onShow 判断是否需要作废
    locHelper.markPoisConsumed(this);
    const scored = scoreCandidates(pois, this.data.scene, this.data.excludeIds);
    // AI 候选保留 2 个探索位，避免候选全部同质化；poi_id 已统一为字符串。
    // 连续"换一批"导致 exclude 较多时，把候选数从 7 扩到 10，
    // 避免候选池（7 个）几乎被 exclude 填满、反复推同几家。
    const excludeLen = (this.data.excludeIds || []).length;
    const candidateN = excludeLen > 6 ? 10 : 7;
    const candidates = topNWithExplore(scored, candidateN, 2);
    const candidateMap = new Map(candidates.map((c) => [c.poi_id, c]));

    const count = this.data.refreshCount;
    const limit = this.data.dailyRefreshLimit;
    const useAI = count < limit;

    if (useAI) {
      try {
        const aiResult = await this.callAIRecommend(candidates, this.data.scene, candidateMap);
        const raw = Array.isArray(aiResult.recommendations) ? aiResult.recommendations : [];

        const valid = raw
          .filter((r) => r && r.poi_id != null && candidateMap.has(String(r.poi_id)))
          .slice(0, 3)
          .map((r) => {
            const candidate = candidateMap.get(String(r.poi_id));
            return {
              poi_id: String(r.poi_id),
              poi: candidate ? candidate.poi : null,
              reason: typeof r.reason === 'string' ? r.reason : ''
            };
          });

        if (valid.length > 0) {
          const cardsView = valid.map(buildCardView);
          this.setData({
            recommendations: valid,
            cardsView,
            source: 'ai',
            loading: false,
            refreshing: false,
            error: ''
          });
          return;
        }
      } catch (e) {
        console.log('AI推荐失败，使用兜底:', e.message);
      }
    }

    this._useFallbackRecommend();
  },

  onRefresh() {
    if (this.data.loading || this.data.refreshing) return;

    if (Date.now() - this.data.lastRefreshTime < this.data.cooldownTime) {
      const remaining = Math.ceil((this.data.cooldownTime - (Date.now() - this.data.lastRefreshTime)) / 1000);
      wx.showToast({ title: `请等待${remaining}秒后再试`, icon: 'none' });
      return;
    }

    if (!this.data.locationOk) {
      this.requestLocation();
      return;
    }
    if (this.data.pois.length === 0) {
      this.loadPoisAndRecommend();
      return;
    }

    const count = this.data.refreshCount;
    const limit = this.data.dailyRefreshLimit;
    if (count >= limit) {
      wx.showToast({ title: '今日推荐次数已用完，明天再试吧', icon: 'none' });
      this._useFallbackRecommend();
      return;
    }

    const currentRecs = this.data.recommendations.map((r) => r.poi_id);
    let newExclude = [...this.data.excludeIds, ...currentRecs];
    // exclude 上限放宽到 15（≈ 两轮"换一批"），避免前几轮推过的店在第 4 次又冒出来。
    // poi 池一般几十家，15 仍远小于池子规模，不会把候选榨干。
    if (newExclude.length > 15) {
      newExclude = newExclude.slice(-15);
    }

    this.setData({
      refreshing: true,
      excludeIds: newExclude,
      lastRefreshTime: Date.now(),
      refreshCount: count + 1
    });

    wx.setStorageSync('dailyRefreshCount', count + 1);
    this.callRecommend(this.data.pois);
  },

  _useFallbackRecommend() {
    const scored = scoreCandidates(this.data.pois, this.data.scene, this.data.excludeIds);
    const top3 = [...scored].sort((a, b) => b.score - a.score).slice(0, 3);

    const recommendations = top3.map((item) => ({
      poi_id: item.poi_id,
      poi: item.poi,
      reason: this._generateReason(item.poi, this.data.scene)
    }));

    const cardsView = recommendations.map(buildCardView);
    this.setData({
      recommendations,
      cardsView,
      source: 'fallback',
      loading: false,
      refreshing: false
    });
  },

  _generateReason(poi, scene) {
    const distance = poi.distance || 0;
    const distanceText = distance >= 1000 ?
      Math.round(distance / 1000) + '公里' :
      Math.round(distance) + '米';

    const rating = poi.rating;
    const type = normalizePoiType(poi.type);

    // 场景语气：让 fallback 文案和 AI 一样"识相"，而非机械复述评分距离。
    // 用场景短句点出"此刻最该吃这个"的感觉，再按店况选一句补足。
    const sceneTone = {
      '早餐': '早饭得趁热',
      '午餐': '中午对付一口',
      '下午茶/饮品': '歇会儿',
      '晚餐': '正儿八经吃顿',
      '夜宵': '夜深解个馋',
      '随便吃点': '随便垫垫'
    }[scene] || '就这家吧';

    // 近 + 高分：双重优势，强调"省心"
    if (rating && rating >= 4.5 && distance < 500) {
      return `${sceneTone}，走${distanceText}就到，这家口碑一直不错`;
    }
    // 高分但稍远：强调"值得走"
    if (rating && rating >= 4.5) {
      return `${sceneTone}，这家${distanceText}外但评分很高，值得走一趟`;
    }
    // 近：强调"省事"
    if (distance < 300) {
      return `${sceneTone}，就${distanceText}的事，溜达过去`;
    }
    // 中规中矩：场景 + 品类，避免"评分X分距离Y米"的说明书腔
    if (rating && rating >= 4.0) {
      return `${sceneTone}，这家的${type}评价挺好`;
    }
    return `${sceneTone}，${distanceText}左右有家${type}`;
  },

  // ===== 卡片操作 =====

  onOpenNav(e) {
    const idx = e.currentTarget.dataset.idx;
    const card = this.data.cardsView[idx];
    if (!card || !card.location) return;
    const [lng, lat] = card.location.split(',').map(Number);
    if (isNaN(lng) || isNaN(lat)) return;
    wx.openLocation({
      longitude: lng,
      latitude: lat,
      name: card.name,
      address: card.address,
      scale: 16
    });
  },

  onCopyAddr(e) {
    const idx = e.currentTarget.dataset.idx;
    const card = this.data.cardsView[idx];
    if (!card) return;
    wx.setClipboardData({
      data: card.address || card.name,
      success: () => wx.showToast({ title: '地址已复制', icon: 'success' })
    });
  },

  onOpenCommercial(e) {
    const idx = e.currentTarget.dataset.idx;
    const card = this.data.cardsView[idx];
    if (!card || !card.shopEntry) return;
    // 按商家名重新查 entry（避免把配置对象塞进卡片 data）
    const entry = commercialHelper.lookupShopEntry(card.name);
    commercialHelper.openEntry(entry);
  },

  // 平台级「领红包」入口点击
  onOpenPlatform(e) {
    const key = e.currentTarget.dataset.key;
    const platform = (this.data.platformButtons || []).find((p) => p.key === key);
    commercialHelper.openEntry(platform);
    // 从弹窗选择时，跳转后自动关闭弹窗
    if (this.data.showCouponPicker) {
      this.setData({ showCouponPicker: false });
    }
  },

  // 红包选择弹窗显隐切换
  onToggleCouponPicker() {
    this.setData({ showCouponPicker: !this.data.showCouponPicker });
  }
});
