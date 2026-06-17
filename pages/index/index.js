// 首页：AI 推荐
// 位置与 POI 数据通过 locationHelper + app.globalData 与 mystery 页面共享
// 盲盒逻辑已迁移至 pages/mystery/

const commercial = require('../../config/commercial.js');
const { SCENE_KEYWORDS, SCENES } = require('../../config/sceneKeywords.js');
const locHelper = require('../../utils/locationHelper.js');

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
function distanceScore(distance) {
  return Math.exp(-distance / 800);
}

function qualityScore(rating) {
  return rating ? rating / 5.0 : 0.3;
}

function sceneMultiplier(scene, poi) {
  const keywords = SCENE_KEYWORDS[scene];
  if (!keywords) return 1.0;
  const haystack = (poi.name || '') + (poi.type || '') + (poi.typecode || '');
  return keywords.some((k) => haystack.indexOf(k) >= 0) ? 1.0 : 0.5;
}

function scoreCandidates(pois, scene, excludeIds) {
  const excludeSet = new Set((excludeIds || []).map(String));
  return pois.map((poi, idx) => {
    const base = 0.5 * distanceScore(poi.distance) + 0.5 * qualityScore(poi.rating);
    const mult = sceneMultiplier(scene, poi);
    let score = base * mult;
    const poiId = String(idx);
    if (excludeSet.has(poiId)) score *= 0.6;
    return { poi_id: poiId, poi, score };
  });
}

function topN(scored, n) {
  return [...scored].sort((a, b) => b.score - a.score).slice(0, n);
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

function sceneLabel(scene) {
  return scene === '下午茶/饮品' ? '下午茶' : scene;
}

function lookupCommercial(name) {
  if (!name) return '';
  const entries = (commercial && commercial.entries) || [];
  const hit = entries.find((e) => e && e.match && name.indexOf(e.match) >= 0);
  return hit ? hit.url : '';
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
    type: poi.type || '餐饮',
    address: poi.address || '',
    location: poi.location || '',
    distanceText: formatDistance(poi.distance),
    ratingText: formatRating(poi.rating),
    costText: poi.cost ? '¥' + poi.cost + '/人' : '',
    reason: rec.reason || '',
    commercialUrl: lookupCommercial(poi.name)
  };
}

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
      const messages = [
        {
          role: 'system',
          content: '你是餐饮推荐助手，根据用户用餐场景和附近商家信息，从候选列表中推荐 1-3 家。' +
            '必须严格返回 JSON，格式：{"recommendations":[{"poi_id":"字符串","reason":"一句话理由"}]}。' +
            'poi_id 必须来自候选列表，理由 25 字以内、自然口语化、不要废话开场白。'
        },
        {
          role: 'user',
          content: JSON.stringify({
            scene,
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

      const model = wx.cloud.extend.AI.createModel('cloudbase');
      const res = await model.streamText({
        data: {
          model: 'hy3-preview',
          messages: messages,
          stream: true,
          response_format: { type: 'json_object' }
        }
      });

      let fullContent = '';
      let eventCount = 0;
      const maxEvents = 100;

      for await (let event of res.eventStream) {
        eventCount++;
        if (eventCount > maxEvents) break;
        if (event.data === '[DONE]') break;
        try {
          const data = JSON.parse(event.data);
          const content = data?.choices?.[0]?.delta?.content ||
                         data?.choices?.[0]?.message?.content ||
                         data?.content;
          if (content && typeof content === 'string') {
            fullContent += content;
          }
        } catch (e) {
          if (event.data && event.data !== '[DONE]') {
            try {
              const rawData = event.data;
              if (rawData && rawData.content) {
                fullContent += rawData.content;
              } else if (typeof rawData === 'string' && rawData.trim()) {
                fullContent += rawData;
              }
            } catch (innerError) {
              // 忽略分片处理失败
            }
          }
        }
      }

      if (!fullContent || fullContent.trim().length === 0) {
        throw new Error('Empty AI response');
      }

      let parsed;
      try {
        parsed = JSON.parse(fullContent);
      } catch (parseError) {
        const cleaned = fullContent.replace(/[ -]/g, '');
        parsed = JSON.parse(cleaned);
      }
      return parsed;
    } catch (e) {
      console.error('AI recommend error:', e);
      throw e;
    }
  },

  async callRecommend(pois) {
    // 本次推荐消费了当前 pois 版本，标记以供 onShow 判断是否需要作废
    locHelper.markPoisConsumed(this);
    const scored = scoreCandidates(pois, this.data.scene, this.data.excludeIds);
    const candidates = topN(scored, 7);
    const candidateMap = new Map(candidates.map((c) => [c.poi_id, c]));

    const count = this.data.refreshCount;
    const limit = this.data.dailyRefreshLimit;
    const useAI = count < limit;

    if (useAI) {
      try {
        const aiResult = await this.callAIRecommend(candidates, this.data.scene, candidateMap);
        const raw = Array.isArray(aiResult.recommendations) ? aiResult.recommendations : [];

        const valid = raw
          .filter((r) => {
            if (!r || !r.poi_id) return false;
            const hasKey = candidateMap.has(r.poi_id) ||
                          candidateMap.has(String(r.poi_id)) ||
                          candidateMap.has(Number(r.poi_id));
            return hasKey;
          })
          .slice(0, 3)
          .map((r) => {
            let candidate = candidateMap.get(r.poi_id) ||
                       candidateMap.get(String(r.poi_id)) ||
                       candidateMap.get(Number(r.poi_id));
            return {
              poi_id: r.poi_id,
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
    if (newExclude.length > 6) {
      newExclude = newExclude.slice(-6);
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
    const ratingText = rating ? rating.toFixed(1) + '分' : '好评';
    const type = poi.type || '餐饮';

    if (rating && rating >= 4.5 && distance < 500) {
      return `这家店评分${ratingText}，距离仅${distanceText}，非常值得尝试`;
    } else if (rating && rating >= 4.5) {
      return `虽然距离${distanceText}，但评分高达${ratingText}，值得一去`;
    } else if (rating && rating >= 4.0) {
      return `距离${distanceText}，评分${ratingText}，性价比不错`;
    } else if (distance < 300) {
      return `距离仅${distanceText}，很近便，${ratingText}的${type}`;
    } else {
      return `${ratingText}的${type}，距离${distanceText}，符合${scene}需求`;
    }
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
    if (!card || !card.commercialUrl) return;
    wx.setClipboardData({
      data: card.commercialUrl,
      success: () =>
        wx.showToast({ title: '优惠链接已复制', icon: 'success', duration: 1500 })
    });
  }
});
