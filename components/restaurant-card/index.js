// 推荐卡片组件。
// 复用全局 .card/.card-header/.action-btn 等样式（app.wxss），故 options.addGlobalClass=true。
// variant:
//   'index'  —— 首页：reason 带 💡 前缀，命中 shopEntry 时底部显示 🎫 按钮
//   'mystery'—— 盲盒：reason 不带前缀，附加 mystery-card/card-mismatch 类，无 🎫、无操作区
// 导航入口统一在地址行（card-loc，点击 onNavigate），不再有独立导航按钮。
Component({
  options: {
    addGlobalClass: true,
    multipleSlots: false
  },
  properties: {
    card: { type: Object, value: {} },
    variant: { type: String, value: 'index' },
    isMismatch: { type: Boolean, value: false }
  },
  methods: {
    onNavigate() {
      this.triggerEvent('navigate', { location: this.data.card.location });
    },
    onCoupon() {
      this.triggerEvent('coupon', { poi_id: this.data.card.poi_id, name: this.data.card.name });
    }
  }
});
