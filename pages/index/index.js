const commercial = require('../../config/commercial.js');

const SCENES = ['早餐', '午餐', '下午茶/饮品', '晚餐', '夜宵', '随便吃点'];

// 场景关键词表
const SCENE_KEYWORDS = {
  '早餐': ['早餐', '包子', '粥', '豆浆', '油条', '肠粉', '面', '粉'],
  '午餐': ['快餐', '简餐', '面食', '粉', '便当', '盖饭'],
  '下午茶/饮品': ['奶茶', '咖啡', '甜品', '烘焙', '果汁', '茶饮', '轻食'],
  '晚餐': ['正餐', '火锅', '烧烤', '炒菜', '饭店'],
  '夜宵': ['烧烤', '小龙虾', '粥', '串', '烤', '宵夜'],
  '随便吃点': null
};

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

// 按时段自动检测场景（详见 design.md §5.4）
function detectScene() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) return '早餐';
  if (hour >= 10 && hour < 14) return '午餐';
  if (hour >= 14 && hour < 17) return '下午茶/饮品';
  if (hour >= 17 && hour < 21) return '晚餐';
  return '夜宵'; // 21h - 次日 5h
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
  console.log('buildCardView输入:', { poi_id: rec.poi_id, name: poi.name, poi: rec });

  const result = {
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

  console.log('buildCardView输出:', result);
  return result;
}

Page({
  data: {
    scenes: SCENES,
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
    coord: null, // { longitude, latitude }
    // 换一批限制
    refreshCount: 0,
    lastRefreshTime: 0,
    dailyRefreshLimit: 20,
    cooldownTime: 2000 // 2秒冷却
  },

  // 场景标签转换（wxml 用）
  _setScene(scene) {
    this.setData({ scene, sceneShort: sceneLabel(scene) });
  },

  onLoad() {
    this._setScene(detectScene());
    this._checkDailyReset(); // 检查是否需要重置每日计数
    // 不再自动调用定位，等待用户点击授权按钮
  },

  // 检查每日重置
  _checkDailyReset() {
    const now = Date.now();
    const lastDate = wx.getStorageSync('lastRefreshDate');
    const today = new Date().toDateString();

    if (lastDate !== today) {
      // 新的一天，重置计数
      wx.setStorageSync('lastRefreshDate', today);
      wx.setStorageSync('dailyRefreshCount', 0);
      this.setData({ refreshCount: 0 });
    } else {
      // 读取今日已用次数
      const count = wx.getStorageSync('dailyRefreshCount') || 0;
      this.setData({ refreshCount: count });
    }
  },

  // 检查冷却时间
  _checkCooldown() {
    const now = Date.now();
    const lastTime = this.data.lastRefreshTime;
    return now - lastTime >= this.data.cooldownTime;
  },

  onSelectScene(e) {
    const scene = e.currentTarget.dataset.scene;
    if (!scene || scene === this.data.scene) return;
    this._setScene(scene);
    this.setData({
      excludeIds: [],
      recommendations: [],
      cardsView: [],
      source: '',
      error: ''
    });
    if (this.data.locationOk && this.data.pois.length > 0) {
      this.callRecommend(this.data.pois);
    } else if (this.data.locationOk) {
      this.loadPoisAndRecommend();
    }
  },

  requestLocation() {
    this.setData({ loading: true, error: '', locationError: '' });

    // 使用微信内置地图选择位置
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          locationOk: true,
          coord: {
            latitude: res.latitude,
            longitude: res.longitude
          },
          address: `当前位置 · ${res.address || res.name || '已选择位置'}`
        });
        this.loadPoisAndRecommend();
      },
      fail: (err) => {
        console.warn('chooseLocation fail:', err);
        this.setData({
          locationOk: false,
          loading: false,
          locationError: '未选择位置，无法推荐附近商家'
        });
      }
    });
  },

  refreshLocation() {
    this.requestLocation();
  },

  loadPoisAndRecommend() {
    const coord = this.data.coord;
    if (!coord) return;
    this.setData({ loading: true, error: '' });
    wx.cloud
      .callFunction({
        name: 'getPoi',
        data: { longitude: coord.longitude, latitude: coord.latitude, radius: 2000 }
      })
      .then((poiRes) => {
        const result = (poiRes && poiRes.result) || {};
        if (result.status !== 'ok' || !result.pois || result.pois.length === 0) {
          this.setData({
            loading: false,
            error: result.message || '附近暂无餐饮商家'
          });
          return;
        }
        this.setData({ pois: result.pois });
        return this.callRecommend(result.pois);
      })
      .catch((e) => {
        console.error('loadPoisAndRecommend error:', e);
        this.setData({ loading: false, error: '获取附近商家失败，请重试' });
      });
  },

  // 使用微信云AI进行推荐
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
          stream: true, // 使用流式调用
          response_format: { type: 'json_object' }
        }
      });

      // 收集流式响应
      let fullContent = '';
      let eventCount = 0;
      const maxEvents = 100; // 防止无限循环

      for await (let event of res.eventStream) {
        eventCount++;
        if (eventCount > maxEvents) {
          console.warn('流式响应事件过多，强制结束');
          break;
        }

        if (event.data === '[DONE]') {
          console.log('流式响应完成');
          break;
        }

        try {
          const data = JSON.parse(event.data);
          // 处理不同格式的响应
          const content = data?.choices?.[0]?.delta?.content ||
                         data?.choices?.[0]?.message?.content ||
                         data?.content;

          if (content && typeof content === 'string') {
            fullContent += content;
            // 只在每收集10个字符后打印一次，避免刷屏
            if (fullContent.length % 10 === 0) {
              console.log('收集内容长度:', fullContent.length);
            }
          }
        } catch (e) {
          // 如果JSON解析失败，可能是分片数据，直接拼接原始数据
          if (event.data && event.data !== '[DONE]') {
            try {
              // 尝试从原始数据中提取content字段
              const rawData = event.data;
              if (rawData && rawData.content) {
                fullContent += rawData.content;
              } else if (typeof rawData === 'string' && rawData.trim()) {
                fullContent += rawData;
              }
            } catch (innerError) {
              console.warn('处理事件数据失败:', innerError.message);
            }
          }
        }
      }

      console.log('AI完整响应内容长度:', fullContent.length);
      console.log('AI完整响应内容:', fullContent);
      console.log('可用的候选poi_id:', Array.from(candidateMap.keys()));

      if (!fullContent || fullContent.trim().length === 0) {
        throw new Error('Empty AI response');
      }

      let parsed;
      try {
        parsed = JSON.parse(fullContent);
        console.log('AI推荐解析成功:', parsed);
      } catch (parseError) {
        console.error('JSON解析失败，原始内容:', fullContent);
        console.error('解析错误位置:', parseError.message);
        // 尝试修复常见的JSON错误
        try {
          // 尝试移除可能的控制字符
          const cleaned = fullContent.replace(/[ --]/g, '');
          parsed = JSON.parse(cleaned);
          console.log('清理后JSON解析成功:', parsed);
        } catch (cleanError) {
          console.error('清理后仍然解析失败');
          throw parseError;
        }
      }
      return parsed;

    } catch (e) {
      console.error('AI recommend error:', e);
      throw e;
    }
  },

  // 主推荐函数（优先使用AI，失败则兜底）
  async callRecommend(pois) {
    const scored = scoreCandidates(pois, this.data.scene, this.data.excludeIds);
    const candidates = topN(scored, 7); // 使用前端评分函数
    const candidateMap = new Map(candidates.map((c) => [c.poi_id, c]));

    console.log('候选商家数量:', candidates.length);
    console.log('候选poi_id类型样本:', candidates.slice(0, 3).map(c => typeof c.poi_id));
    console.log('候选poi_id样本:', candidates.slice(0, 3).map(c => c.poi_id));
    console.log('候选Map键值对样本:', Array.from(candidateMap.entries()).slice(0, 3));

    // 检查是否超过每日限制
    const count = this.data.refreshCount;
    const limit = this.data.dailyRefreshLimit;
    const useAI = count < limit;

    if (useAI) {
      try {
        console.log('尝试使用AI推荐...');
        const aiResult = await this.callAIRecommend(candidates, this.data.scene, candidateMap);

        const raw = Array.isArray(aiResult.recommendations) ? aiResult.recommendations : [];
        console.log('AI返回的推荐数量:', raw.length);
        console.log('AI返回的poi_id列表:', raw.map(r => r.poi_id));

        const valid = raw
          .filter((r) => {
            if (!r || !r.poi_id) return false;
            // 尝试多种类型匹配
            const hasKey = candidateMap.has(r.poi_id) ||
                          candidateMap.has(String(r.poi_id)) ||
                          candidateMap.has(Number(r.poi_id));
            if (!hasKey) {
              console.warn('poi_id未找到:', r.poi_id, '类型:', typeof r.poi_id);
            }
            return hasKey;
          })
          .slice(0, 3)
          .map((r) => {
            // 尝试多种方式获取候选
            let candidate = candidateMap.get(r.poi_id) ||
                       candidateMap.get(String(r.poi_id)) ||
                       candidateMap.get(Number(r.poi_id));

            console.log('处理推荐:', r.poi_id, '找到的candidate:', candidate ? 'YES' : 'NO');
            if (candidate) {
              console.log('候选详情:', candidate.poi);
            }

            return {
              poi_id: r.poi_id,
              poi: candidate ? candidate.poi : null,
              reason: typeof r.reason === 'string' ? r.reason : ''
            };
          });

        console.log('验证后的推荐数量:', valid.length);
        console.log('验证后的poi_id列表:', valid.map(r => r.poi_id));
        console.log('验证后的推荐详情:', valid.map(r => ({
          poi_id: r.poi_id,
          name: r.poi?.name,
          reason: r.reason
        })));

        if (valid.length > 0) {
          console.log('AI推荐成功，返回', valid.length, '个推荐');
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

    // 兜底机制
    console.log('使用兜底推荐');
    this._useFallbackRecommend();
  },

  onRefresh() {
    if (this.data.loading || this.data.refreshing) return;

    // 检查冷却时间
    if (!this._checkCooldown()) {
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

    // 检查每日限制
    const count = this.data.refreshCount;
    const limit = this.data.dailyRefreshLimit;
    if (count >= limit) {
      wx.showToast({ title: '今日推荐次数已用完，明天再试吧', icon: 'none' });
      // 超过限制后直接使用兜底，不再调用云函数
      this._useFallbackRecommend();
      return;
    }

    // 管理 excludeIds：保留最近2轮（最多6个）
    const currentRecs = this.data.recommendations.map((r) => r.poi_id);
    let newExclude = [...this.data.excludeIds, ...currentRecs];
    if (newExclude.length > 6) {
      // 保留最近6个（2轮）
      newExclude = newExclude.slice(-6);
    }

    // 更新状态
    this.setData({
      refreshing: true,
      excludeIds: newExclude,
      lastRefreshTime: Date.now(),
      refreshCount: count + 1
    });

    // 保存今日计数
    wx.setStorageSync('dailyRefreshCount', count + 1);

    this.callRecommend(this.data.pois);
  },

  // 超过限制后使用本地兜底推荐
  _useFallbackRecommend() {
    // 使用完整的评分函数
    const scored = scoreCandidates(this.data.pois, this.data.scene, this.data.excludeIds);

    // 取 top 3
    const top3 = [...scored].sort((a, b) => b.score - a.score).slice(0, 3);

    // 生成推荐理由
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
      refreshing: false
    });
  },

  // 本地推荐理由生成（与云函数保持一致）
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
    // 小程序受 webview 域名白名单限制，MVP 简化为复制链接
    wx.setClipboardData({
      data: card.commercialUrl,
      success: () =>
        wx.showToast({ title: '优惠链接已复制', icon: 'success', duration: 1500 })
    });
  }
});
