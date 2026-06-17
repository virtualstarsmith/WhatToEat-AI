// 商业化（CPS 分销）跳转分发工具
// 配置见 config/commercial.js；供 pages/index（及后续 pages/mystery）复用。
//
// 两类入口：
//   getPlatformButtons()  平台级「领红包」按钮（enabled 且 appId+path 齐全）
//   lookupShopEntry(name) 按商家名关键词匹配的专属入口（兼容旧 entries）
// 点击行为统一走 openEntry(entry)，按 type 分发。

const commercial = require('../config/commercial.js');

// 平台级入口：启用且配置齐全才算「可跳」
function getPlatformButtons() {
  const list = (commercial && commercial.platforms) || [];
  return list.filter((p) => p && p.enabled !== false && p.appId && p.path);
}

// 按商家名关键词匹配（兼容旧 entries 结构）
function lookupShopEntry(name) {
  if (!name) return null;
  const entries = (commercial && commercial.entries) || [];
  return entries.find((e) => e && e.match && name.indexOf(e.match) >= 0) || null;
}

// 按 type 分发跳转
//   'miniprogram' → wx.navigateToMiniProgram
//   'webview'     → MVP 回退复制（业务域名未配），console 提示 TODO
//   'copy'/缺省    → 复制 url
function openEntry(entry) {
  if (!entry) return;
  const type = entry.type || 'copy';

  if (type === 'miniprogram') {
    if (!entry.appId || !entry.path) {
      wx.showToast({ title: '推广链接未配置', icon: 'none' });
      return;
    }
    wx.navigateToMiniProgram({
      appId: entry.appId,
      path: entry.path,
      envVersion: entry.envVersion || 'release',
      fail(err) {
        wx.showToast({ title: '跳转失败，请重试', icon: 'none' });
        console.warn('[commercial] navigateToMiniProgram fail', err);
      }
    });
    return;
  }

  // copy 与 webview（MVP 回退）都走复制
  if (entry.url) {
    wx.setClipboardData({
      data: entry.url,
      success: () =>
        wx.showToast({
          title: type === 'webview' ? '链接已复制（H5待配置）' : '优惠链接已复制',
          icon: 'success',
          duration: 1500
        })
    });
    if (type === 'webview') {
      // TODO: 配置业务域名 + 新增 pages/webview/index 后，改为跳转加载该 url
      console.warn('[commercial] webview 类型待接入（需业务域名 + pages/webview/index）', entry.url);
    }
  }
}

module.exports = {
  getPlatformButtons,
  lookupShopEntry,
  openEntry
};
