// 盲盒推荐页面
// 算法逻辑迁移自原 index.js，数据通过 locationHelper + app.globalData 与 index 页面共享
// 详见 .trellis/tasks/06-14-mystery-box-feature/design.md

const mb = require('../../utils/mysteryBox.js');
const locHelper = require('../../utils/locationHelper.js');
const { SCENES } = require('../../config/sceneKeywords.js');

// 按时段自动检测场景（与 index.js 保持一致）
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

function formatDistance(d) {
  if (d == null) return '';
  return d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
}

function formatRating(r) {
  return r ? r.toFixed(1) : '无评分';
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
      history: [],
      openedIds: [],
      lastOpenTime: 0,
      cooldownTime: 2000,
      poolExhausted: false
    }
  },

  onLoad() {
    this.setData({ scene: detectScene(), sceneShort: sceneLabel(detectScene()) });
  },

  onShow() {
    // 每次显示时从全局同步位置与 POI 数据（其他 tab 可能已授权）
    locHelper.syncFromGlobal(this);
    // 更新 tabBar 选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    // pois 在本页非活跃期间被更新（如在 AI 页切换了定位）→ 重置盲盒，清掉旧位置开过的盒
    if (locHelper.poisUpdatedSince(this)) {
      locHelper.markPoisConsumed(this);
      this._resetMysteryBox();
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
    this.setData({
      mysteryBox: {
        status: 'idle',
        currentResult: null,
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
      wx.showToast({ title: '附近盲盒已开完，换个位置吧', icon: 'none' });
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
      wx.showToast({ title: '附近盲盒已开完，换个位置吧', icon: 'none' });
      return;
    }

    this.setData({
      'mysteryBox.status': 'opening',
      'mysteryBox.lastOpenTime': Date.now()
    });

    wx.vibrateShort({ type: 'medium', fail: () => {} });

    setTimeout(() => {
      this._revealMysteryBox(result);
    }, 2000);
  },

  _revealMysteryBox(result) {
    const poi = result.poi;
    const reason = mb.generateMysteryReason(poi, this.data.scene);
    const poiScene = mb.detectPoiScene(poi);
    const isMismatch = mb.isSceneMismatch(poiScene, this.data.scene);

    const cardView = {
      poi_id: result.poi_id,
      name: poi.name || '未知店铺',
      type: poi.type || '餐饮',
      address: poi.address || '',
      location: poi.location || '',
      distanceText: formatDistance(poi.distance),
      ratingText: formatRating(poi.rating),
      costText: poi.cost ? '¥' + poi.cost + '/人' : '',
      reason,
      isMismatch
    };

    const history = [
      { poi_id: result.poi_id, name: poi.name || '神秘店铺', card: cardView, openedAt: Date.now(), rank: this.data.mysteryBox.history.length + 1 },
      ...this.data.mysteryBox.history
    ].slice(0, 20);

    const openedIds = [...this.data.mysteryBox.openedIds, result.poi_id];

    wx.vibrateShort({ type: 'light', fail: () => {} });

    this.setData({
      'mysteryBox.status': 'revealed',
      'mysteryBox.currentResult': cardView,
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
      'mysteryBox.currentResult': item.card
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

  onMysteryCopyAddr() {
    const card = this.data.mysteryBox.currentResult;
    if (!card) return;
    wx.setClipboardData({
      data: card.address || card.name,
      success: () => wx.showToast({ title: '地址已复制', icon: 'success' })
    });
  }
});
