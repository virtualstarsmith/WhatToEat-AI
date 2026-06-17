// 商业化（CPS 分销）配置
//
// 两类入口：
//   platforms —— 平台级「领红包」入口（主返佣来源），每家平台一条
//               点击跳官方小程序红包/落地页，携带你的推广位（sid/inviterid）
//   entries   —— 按商家名关键词匹配的专属入口（兼容兜底），默认空
//
// type 决定点击行为（dispatch 在 utils/commercialHelper.js openEntry）：
//   'miniprogram'  wx.navigateToMiniProgram(appId, path)   ← 推荐主路径
//   'webview'      MVP 暂回退复制（业务域名未配）；后续跳 pages/webview/index
//   'copy' / 缺省   复制 url 到剪贴板
//
// ⚠️ 真实 appId / path 必须由你到各联盟后台实名注册后填入：
//      美团：union.meituan.com（美团联盟，外卖佣金约 3%）
//      饿了么：pub.alimama.com（阿里妈妈/淘宝联盟）
//      京东外卖：union.jd.com（京东联盟，CPS 渠道待成熟）
//    未填则对应入口不展示（getPlatformButtons 会过滤掉），无任何视觉影响。

module.exports = {
  // 平台级「领红包」入口（卡片区域展示，主返佣）
  platforms: [
    {
      key: 'meituan',
      label: '美团红包',
      type: 'miniprogram',
      appId: '',        // TODO: 美团外卖官方小程序 appId（美团联盟后台获取）
      path: '',         // TODO: 带 SID 的红包页路径，如 pages/xxx?sid=你的SID
      enabled: true
    },
    {
      key: 'eleme',
      label: '饿了么红包',
      type: 'miniprogram',
      appId: '',        // TODO: 饿了么官方小程序 appId（淘宝联盟/阿里妈妈获取）
      // 饿了么常用红包活动 ID：20150318020002192（以联盟后台实际为准）
      path: '',         // TODO: pages/xxx?inviterid=你的inviterid&activityId=20150318020002192
      enabled: true
    },
    {
      key: 'jd',
      label: '京东外卖',
      type: 'miniprogram',
      appId: '',        // TODO: 京东/京东外卖小程序 appId（京东联盟，CPS 渠道待开放）
      path: '',
      enabled: false    // 京东外卖 CPS 尚不成熟，默认关闭；渠道开放后置 true
    }
  ],

  // 按商家名关键词匹配的专属入口（兼容旧结构，兜底）
  // 命中商家名时，对应卡片展示 🎫 按钮
  //   { match: '麦当劳', type: 'miniprogram', appId: 'wx...', path: '...' }
  //   { match: '蜜雪冰城', type: 'copy', url: 'https://...' }   // 无 type 默认 copy
  entries: []
};
