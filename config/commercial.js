// 商业化入口手动配置。
// MVP 阶段不对接 CPS；每条 entry 用 match 关键词匹配商家名，命中则在卡片展示优惠按钮。
// 点击优惠按钮当前实现为复制链接到剪贴板（H5 跳转需另行处理 webview 域名配置）。
//
// 示例（默认为空，无任何商业化展示）：
// {
//   entries: [
//     { match: '麦当劳', url: 'https://your-promo.example.com/mcdonalds' },
//     { match: '肯德基', url: 'https://your-promo.example.com/kfc' },
//     { match: '蜜雪冰城', url: 'https://your-promo.example.com/mxbc' }
//   ]
// }

module.exports = {
  entries: []
};
