// 位置与 POI 共享工具
// 封装位置授权、getPoi 调用，并将结果写入 app.globalData 供两个 tab 页面共享
// 详见 .trellis/tasks/06-14-mystery-box-feature/design.md

const POI_CACHE_TTL = 5 * 60 * 1000; // POI 缓存有效期 5 分钟

// 读取全局共享数据
function getGlobalData() {
  return getApp().globalData || {};
}

// 同步全局状态到页面 data（供页面 onShow 调用）
function syncFromGlobal(page) {
  const g = getGlobalData();
  page.setData({
    locationOk: !!g.locationOk,
    address: g.address || '',
    locationError: g.locationError || '',
    pois: g.pois || []
  });
}

// 发起位置授权选择，成功后获取 POI 并写入 globalData
// 返回 Promise<pois>，失败时 reject
function chooseLocationAndGetPois() {
  const app = getApp();
  return new Promise((resolve, reject) => {
    wx.chooseLocation({
      success: (res) => {
        const coord = {
          latitude: res.latitude,
          longitude: res.longitude
        };
        const address = `当前位置 · ${res.address || res.name || '已选择位置'}`;

        // 写入全局共享
        app.globalData.coord = coord;
        app.globalData.address = address;
        app.globalData.locationOk = true;
        app.globalData.locationError = '';

        // 调用 getPoi
        fetchPois(coord)
          .then((pois) => resolve(pois))
          .catch((err) => reject(err));
      },
      fail: (err) => {
        console.warn('chooseLocation fail:', err);
        app.globalData.locationError = '未选择位置，无法推荐附近商家';
        reject(new Error('chooseLocation cancelled'));
      }
    });
  });
}

// 调用 getPoi 云函数，结果写入 globalData
function fetchPois(coord) {
  const app = getApp();
  if (!coord) {
    return Promise.reject(new Error('coord required'));
  }

  // 缓存命中判断（同一坐标 + TTL 内）
  const g = app.globalData;
  const now = Date.now();
  const cacheFresh = g.pois && g.pois.length > 0 && (now - (g.poisLoadedAt || 0)) < POI_CACHE_TTL;
  if (cacheFresh) {
    return Promise.resolve(g.pois);
  }

  return wx.cloud
    .callFunction({
      name: 'getPoi',
      data: { longitude: coord.longitude, latitude: coord.latitude, radius: 2000 }
    })
    .then((poiRes) => {
      const result = (poiRes && poiRes.result) || {};
      if (result.status !== 'ok' || !result.pois || result.pois.length === 0) {
        throw new Error(result.message || '附近暂无餐饮商家');
      }
      // 写入全局共享
      app.globalData.pois = result.pois;
      app.globalData.poisLoadedAt = Date.now();
      return result.pois;
    });
}

// 仅刷新 POI（坐标不变，重新拉取），用于「刷新」按钮
function refreshPois() {
  const g = getGlobalData();
  if (!g.coord) {
    return chooseLocationAndGetPois();
  }
  // 强制刷新：清空时间戳
  getApp().globalData.poisLoadedAt = 0;
  return fetchPois(g.coord);
}

// 重置 POI 缓存（位置变化或需要强制重新获取时调用）
function invalidatePoisCache() {
  const app = getApp();
  app.globalData.pois = [];
  app.globalData.poisLoadedAt = 0;
}

module.exports = {
  syncFromGlobal,
  chooseLocationAndGetPois,
  fetchPois,
  refreshPois,
  invalidatePoisCache,
  POI_CACHE_TTL
};
