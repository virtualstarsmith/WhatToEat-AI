// 悬浮红包组件：🧧 浮动按钮（平台数>0 时显示）+ 底部 action-sheet。
// 复用全局 .float-coupon/.coupon-mask/.coupon-picker 类（当前未定义样式，行为等同现状）。
// 仅首页使用（盲盒页无红包入口，已移除死代码）。
Component({
  options: {
    addGlobalClass: true
  },
  properties: {
    platforms: { type: Array, value: [] },
    show: { type: Boolean, value: false }
  },
  methods: {
    onToggle() {
      this.triggerEvent('toggle');
    },
    onOpen(e) {
      this.triggerEvent('open', { key: e.currentTarget.dataset.key });
    }
  }
});
