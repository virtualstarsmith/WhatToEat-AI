// 部署前在微信云开发控制台拿到 env ID 后，替换下方常量。
// 占位状态下 wx.cloud.init 会被跳过，避免 traceUser 触发超时。
const CLOUD_ENV = 'cloud1-d9g9rlmpp3a746cac';

App({
  globalData: {
    appName: 'WhatToEat-AI',
    // 跨页面共享的位置与 POI 数据（index 与 mystery 页面共用）
    coord: null,          // { longitude, latitude }
    address: '',          // 位置栏展示文本
    pois: [],             // getPoi 返回的标准化 POI 列表
    poisCoord: null,      // 产出当前 pois 的坐标（缓存命中时校验，避免切换定位后误用旧 POI）
    locationOk: false,    // 是否已授权定位
    locationError: '',    // 定位错误信息
    poisLoadedAt: 0       // pois 加载时间戳（用于判断是否需要刷新）
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('[WhatToEat-AI] 当前微信基础库不支持云开发，请使用 2.2.3 或以上版本基础库');
    } else if (CLOUD_ENV === 'your-env-id') {
      console.warn(
        '[WhatToEat-AI] CLOUD_ENV 仍为占位值，已跳过 wx.cloud.init。' +
        '请在微信云开发控制台开通环境，并在 app.js 顶部把 CLOUD_ENV 替换为实际 env ID。'
      );
    } else {
      wx.cloud.init({
        env: CLOUD_ENV,
        traceUser: true
      });
    }

    // 强制冷启动进入"手气抽签"（App 差异化首屏）。
    // 微信自定义 tabBar 会记忆"上次停留的 tab"并在下次打开恢复，导致用户上次停在
    // AI甄选后，再次打开不进手气抽签——与"AI帮你定"的首屏定位冲突。onLaunch 强制 switchTab 覆盖。
    // 仅冷启动生效（onLaunch 只在冷启动触发），热启动（后台→前台）不强制打断用户。
    wx.switchTab({ url: '/pages/mystery/mystery', fail: function () {} });
  }
});
