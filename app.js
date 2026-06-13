// 部署前在微信云开发控制台拿到 env ID 后，替换下方常量。
// 占位状态下 wx.cloud.init 会被跳过，避免 traceUser 触发超时。
const CLOUD_ENV = 'cloud1-d9g9rlmpp3a746cac';

App({
  globalData: {
    appName: 'WhatToEat-AI'
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('[WhatToEat-AI] 当前微信基础库不支持云开发，请使用 2.2.3 或以上版本基础库');
      return;
    }
    if (CLOUD_ENV === 'your-env-id') {
      console.warn(
        '[WhatToEat-AI] CLOUD_ENV 仍为占位值，已跳过 wx.cloud.init。' +
        '请在微信云开发控制台开通环境，并在 app.js 顶部把 CLOUD_ENV 替换为实际 env ID。'
      );
      return;
    }
    wx.cloud.init({
      env: CLOUD_ENV,
      traceUser: true
    });
  }
});
