// 商业化（CPS 分销）配置
//
// 两类入口：
//   platforms —— 平台级「领红包」入口（主返佣来源），每家平台一条
//               点击跳聚推客「外卖美食团购」插件，携带 pub_id（你的聚推客推广位）
//   entries   —— 按商家名关键词匹配的专属入口（兼容兜底），默认空
//
// type 决定点击行为（dispatch 在 utils/commercialHelper.js openEntry）：
//   'plugin'       wx.navigateTo('plugin://<provider>/<path>?pub_id=xxx')  ← 聚推客插件主路径
//   'miniprogram'  wx.navigateToMiniProgram(appId, path)
//   'webview'      MVP 暂回退复制（业务域名未配）；后续跳 pages/webview/index
//   'copy' / 缺省   复制 url 到剪贴板
//
// ⚠️ 当前只接聚推客（聚合型微信小程序插件）：
//      插件别名 meishi（plugin://meishi/...），provider wx5c787b48e6a02a51
//      微信后台「插件管理」添加「外卖美食团购」后即可用；version 以后台详情页为准。
//      pub_id 在聚推客联盟 jutuike.com 注册 → 推广位管理获取（归因/返佣来源，必填）。
//
//    聚推客插件 shop 页（外卖入口）必须带 type + sid=plugin，否则页面加载异常：
//      type=meituan 美团外卖 ｜ type=ele 饿了么外卖
//      sid=plugin 是固定值（表示"来自插件渠道"），不是推广位；归因靠 pub_id。
//    pluginPath 内含 query（如 shop?type=meituan&sid=plugin）时，openEntry 会用 & 追加 pub_id。
//    未填 pub_id 则跳转成功但无归因 = 无佣金；getPlatformButtons 过滤需 pluginProvider + pluginPath 齐全。

module.exports = {
  // 平台级「领红包」入口（卡片区域展示，主返佣）
  platforms: [
    {
      key: 'meituan',
      label: '美团红包',
      type: 'plugin',
      pluginProvider: 'meishi', // 对应 app.json plugins 字段的别名 key（plugin://meishi/...）
      pluginPath: 'shop?type=meituan&sid=plugin', // 聚推客插件 shop 页：美团外卖
      pubId: '469210', // 聚推客联盟推广位 pub_id（归因/返佣来源）
      enabled: true
    },
    {
      key: 'ele',
      label: '饿了么红包',
      type: 'plugin',
      pluginProvider: 'meishi',
      pluginPath: 'shop?type=ele&sid=plugin', // 聚推客插件 shop 页：饿了么外卖
      pubId: '469210',
      enabled: true
    }
  ],

  // 按商家名关键词匹配的专属入口（兼容旧结构，兜底）
  // 命中商家名时，对应卡片展示 🎫 按钮
  //   { match: '麦当劳', type: 'miniprogram', appId: 'wx...', path: '...' }
  //   { match: '蜜雪冰城', type: 'copy', url: 'https://...' }   // 无 type 默认 copy
  entries: []
};
