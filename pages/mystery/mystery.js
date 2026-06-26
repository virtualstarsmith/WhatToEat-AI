// 盲盒推荐页面
// 算法逻辑迁移自原 index.js，数据通过 locationHelper + app.globalData 与 index 页面共享
// 详见 .trellis/tasks/06-14-mystery-box-feature/design.md

const mb = require('../../utils/mysteryBox.js');
const locHelper = require('../../utils/locationHelper.js');
const commercialHelper = require('../../utils/commercialHelper.js');
const { normalizePoiType } = require('../../utils/util.js');
const { detectScene, formatDistance, formatRating, pad2 } = require('../../utils/recommend.js');
const { streamAiText } = require('../../utils/aiRecommend.js');

function sceneLabel(scene) {
  return scene === '下午茶/饮品' ? '下午茶' : scene;
}

// detectScene / formatDistance / formatRating / pad2 已抽到 utils/recommend.js 共享
// （见 06-24-recommend-module）。buildMysteryPrompt 内的 pad2 调用自动解析到共享版。

// 为盲盒揭晓构造 AI prompt。
// 盲盒的卖点不是"最优"，而是"惊喜"——所以 system prompt 引导模型
// 写出"为什么这家值得碰碰运气/换个口味"的语气，而非强调评分距离。
function buildMysteryPrompt(poi, scene) {
  const now = new Date();
  const timeText = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const weekdayText = '周' + '日一二三四五六'[now.getDay()];
  const type = normalizePoiType(poi.type);
  const ratingText = poi.rating ? poi.rating.toFixed(1) + '分' : '暂无评分';
  const costText = poi.cost ? poi.cost + '元/人' : '人均未知';

  const messages = [
    {
      role: 'system',
      content:
        '你是一个爱探索美食的朋友，刚刚帮用户"凭手气"随机抽中了附近一家店。' +
        '这家店不一定是评分最高的，但手气好就该去。用一句话（20 字以内）告诉用户' +
        '为什么这家值得去试试，语气要带点惊喜感和"手气不错，既然抽到了就去呗"的洒脱，' +
        '别复述评分距离。必须严格返回 JSON：{"reason":"一句话"}。'
    },
    {
      role: 'user',
      content: JSON.stringify({
        scene,
        time: timeText,
        weekday: weekdayText,
        shop: {
          name: poi.name || '',
          type,
          distance: poi.distance,
          rating: poi.rating,
          cost: poi.cost
        }
      })
    }
  ];
  return messages;
}

// 调 AI 取盲盒惊喜理由。失败/超时一律 resolve(null)，由调用方回退本地模板。
// 返回 Promise<string|null>。
async function callMysteryAIReason(poi, scene) {
  try {
    const messages = buildMysteryPrompt(poi, scene);
    // 流式收集复用 utils/aiRecommend.streamAiText（与首页同源，消除双份复制）。
    // reason 提取保留盲盒自己的逻辑（取 reason 字段，与首页取 recommendations[] 不同，
    // 故不套 parseRecommendJson）。见 06-24-ai-recommend。
    const fullContent = await streamAiText(messages, {});

    if (!fullContent || !fullContent.trim()) return null;

    // 解析 {reason: "..."}；兼容 markdown 围栏和前后噪声
    const cleaned = fullContent.replace(/[\u200b-\u200d\ufeff]/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) {
        try { parsed = JSON.parse(fence[1].trim()); } catch (e2) { parsed = null; }
      }
    }
    const reason = parsed && typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    return reason || null;
  } catch (e) {
    console.log('[mystery] AI reason 失败，回退本地模板:', e.message);
    return null;
  }
}

Page({
  data: {
    scene: '随便吃点',
    sceneShort: '随便吃点',
    address: '',
    locationOk: false,
    locationError: '',
    pois: [],
    // 盲盒状态
    mysteryBox: {
      status: 'idle',        // idle | opening | revealed
      currentResult: null,
      currentRank: 0,        // 当前在上方展示的历史条目序号（rank），用于列表选中态
      history: [],
      openedIds: [],
      lastOpenTime: 0,
      cooldownTime: 2000,
      poolExhausted: false
    },
    // CPS 红包入口（与 index 页共享逻辑，用 coupon-float 组件渲染）
    platformButtons: [],
    showCouponPicker: false,
    locating: false  // 自动定位中（首屏静默定位，避免空状态闪烁）
  },

  onLoad() {
    this.setData({ scene: detectScene(), sceneShort: sceneLabel(detectScene()) });
    this.setData({ platformButtons: commercialHelper.getPlatformButtons() });
    // 首屏自动定位：mystery 调换为 Tab1 后，用户直接落地本页，全局尚无 pois，
    // 需主动触发静默定位（与 index onLoad 行为一致）。失败回退手动选点。
    this.setData({ locating: true });
    locHelper.locateAndGetPois()
      .then((pois) => {
        locHelper.syncFromGlobal(this);
        this.setData({ locating: false });
      })
      .catch(() => {
        // 自动定位失败/拒绝 → 回退到手动选点（chooseLocationAndGetPois）
        this.setData({ locating: false });
        this.requestLocation();
      });
  },

  onShow() {
    // 若上次抽签在 opening 中途切走（onHide 已清 timer，但 status 仍卡在 opening），
    // 重置为 idle，视为本次抽签作废——比"后台偷偷揭晓"更可控。
    if (this.data.mysteryBox.status === 'opening') {
      this.setData({ 'mysteryBox.status': 'idle' });
    }
    // 每次显示时从全局同步位置与 POI 数据（其他 tab 可能已授权）
    locHelper.syncFromGlobal(this);
    // 更新 tabBar 选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    // pois 在本页非活跃期间被更新（如在 AI 页切换了定位）→ 重置盲盒，清掉旧位置开过的盒
    if (locHelper.poisUpdatedSince(this)) {
      locHelper.markPoisConsumed(this);
      this._resetMysteryBox();
    }
  },

  onHide() {
    // 页面隐藏（切 tab）时清理开盒动画 timer，避免后台触发脏 setData。
    // status 若卡在 opening 由下次 onShow 重置。
    this._clearOpenTimer();
  },

  onUnload() {
    this._clearOpenTimer();
  },

  // 清理开盒动画 timer（onHide/onUnload/重置时调用）。
  // timer id 存实例属性而非 data：不参与渲染，避免 setData 开销（与 _poisConsumedAt 同模式）。
  _clearOpenTimer() {
    if (this._openTimer) {
      clearTimeout(this._openTimer);
      this._openTimer = null;
    }
  },

  _setScene(scene) {
    this.setData({ scene, sceneShort: sceneLabel(scene) });
  },

  // ===== 位置相关（接入 locationHelper）=====

  requestLocation() {
    this.setData({ locationError: '' });
    locHelper.chooseLocationAndGetPois()
      .then((pois) => {
        locHelper.syncFromGlobal(this);
        this._resetMysteryBox();
        locHelper.markPoisConsumed(this);
      })
      .catch(() => {
        locHelper.syncFromGlobal(this);
      });
  },

  refreshLocation() {
    this.requestLocation();
  },

  // ===== 盲盒逻辑 =====

  _resetMysteryBox() {
    this._clearOpenTimer(); // 重置时不应有遗留的开盒揭晓
    this.setData({
      mysteryBox: {
        status: 'idle',
        currentResult: null,
        currentRank: 0,
        history: [],
        openedIds: [],
        lastOpenTime: 0,
        cooldownTime: 2000,
        poolExhausted: false
      }
    });
  },

  _checkCooldown() {
    const now = Date.now();
    return now - this.data.mysteryBox.lastOpenTime >= this.data.mysteryBox.cooldownTime;
  },

  onOpenMysteryBox() {
    const mbState = this.data.mysteryBox;

    if (mbState.status === 'opening') return;
    if (mbState.poolExhausted) {
      wx.showToast({ title: '附近的好签都被抽完了，换个位置吧', icon: 'none' });
      return;
    }

    if (!this._checkCooldown() && mbState.status === 'revealed') {
      const remaining = Math.ceil((mbState.cooldownTime - (Date.now() - mbState.lastOpenTime)) / 1000);
      wx.showToast({ title: `请等待${remaining}秒`, icon: 'none' });
      return;
    }

    if (!this.data.locationOk) {
      wx.showToast({ title: '请先授权定位', icon: 'none' });
      this.requestLocation();
      return;
    }
    if (this.data.pois.length === 0) {
      wx.showToast({ title: '附近暂无商家', icon: 'none' });
      return;
    }

    const result = mb.mysteryBoxRecommend(
      this.data.pois,
      mbState.openedIds,
      this.data.scene
    );

    if (!result) {
      this.setData({ 'mysteryBox.poolExhausted': true });
      wx.showToast({ title: '附近的好签都被抽完了，换个位置吧', icon: 'none' });
      return;
    }

    this.setData({
      'mysteryBox.status': 'opening',
      'mysteryBox.lastOpenTime': Date.now()
    });

    wx.vibrateShort({ type: 'medium', fail: () => {} });

    // 探索档（次优但有趣的店）：并行发起 AI 惊喜理由请求。
    // 与 2s 开盒动画并行，不额外增加用户等待。揭晓时若 AI 已就绪则用，
    // 否则用本地模板——失败/超时不阻塞开盒体验。
    // 利用档（高分店）直接用本地模板，把 AI 成本花在惊喜店上。
    let aiReasonPromise = null;
    if (result.fromExplore) {
      aiReasonPromise = callMysteryAIReason(result.poi, this.data.scene);
    }

    // 开盒动画 timer：保存 id 以便 onHide/onUnload/重置时清理，避免后台脏 setData。
    // 设新 timer 前先清旧（防重入）。
    this._clearOpenTimer();
    this._openTimer = setTimeout(() => {
      this._openTimer = null;
      this._revealMysteryBox(result, aiReasonPromise);
    }, 2000);
  },

  async _revealMysteryBox(result, aiReasonPromise) {
    const poi = result.poi;
    const poiScene = mb.detectPoiScene(poi);
    const isMismatch = mb.isSceneMismatch(poiScene, this.data.scene);

    // 本地模板理由（保底，一定能拿到）。tier 决定文案调性（手气爆棚/冷门惊喜/中段/利用）。
    const fallbackReason = mb.generateMysteryReason(poi, this.data.scene, result.tier);

    // 场景严重不匹配（如夜宵时段开出早餐店）一律用模板的硬提示，不覆盖
    let reason = fallbackReason;
    if (!isMismatch && aiReasonPromise) {
      // 探索档：等 AI 结果（2s 动画期内大概率已返回）
      const aiReason = await aiReasonPromise;
      if (aiReason) reason = aiReason;
    }

    const cardView = {
      poi_id: result.poi_id,
      name: poi.name || '未知店铺',
      type: normalizePoiType(poi.type),
      address: poi.address || '',
      location: poi.location || '',
      distanceText: formatDistance(poi.distance),
      ratingText: formatRating(poi.rating),
      costText: poi.cost ? '¥' + poi.cost + '/人' : '',
      reason,
      isMismatch
    };

    // 不用数组展开 [...items]：微信开发者工具转译会外链 @babel/runtime 的 arrayWithoutHoles
    // 等 helper（项目未装该 runtime），运行时报 module not defined。改用 concat 拼接，等价。
    const history = [{
      poi_id: result.poi_id,
      name: poi.name || '神秘店铺',
      card: cardView,
      openedAt: Date.now(),
      rank: this.data.mysteryBox.history.length + 1
    }].concat(this.data.mysteryBox.history).slice(0, 20);

    const openedIds = this.data.mysteryBox.openedIds.concat(result.poi_id);

    wx.vibrateShort({ type: 'light', fail: () => {} });

    this.setData({
      'mysteryBox.status': 'revealed',
      'mysteryBox.currentResult': cardView,
      'mysteryBox.currentRank': history[0].rank,
      'mysteryBox.history': history,
      'mysteryBox.openedIds': openedIds
    });
  },

  onMysteryAgain() {
    this.onOpenMysteryBox();
  },

  onReopenHistory(e) {
    const idx = e.currentTarget.dataset.idx;
    const item = this.data.mysteryBox.history[idx];
    if (!item || !item.card) return;
    this.setData({
      'mysteryBox.status': 'revealed',
      'mysteryBox.currentResult': item.card,
      'mysteryBox.currentRank': item.rank
    });
  },

  onMysteryNav() {
    const card = this.data.mysteryBox.currentResult;
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

  // 平台级「领红包」入口点击（coupon-float 组件 triggerEvent('open', { key })）
  onOpenPlatform(e) {
    const key = e.detail.key;
    const platform = (this.data.platformButtons || []).find((p) => p.key === key);
    commercialHelper.openEntry(platform);
    if (this.data.showCouponPicker) {
      this.setData({ showCouponPicker: false });
    }
  },

  // 红包选择弹窗显隐切换（coupon-float 组件 triggerEvent('toggle')）
  onToggleCouponPicker() {
    this.setData({ showCouponPicker: !this.data.showCouponPicker });
  }
});
