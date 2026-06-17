// 自定义底部 TabBar 组件
// 纯文字设计，2 个 tab 无需图标，保持简洁专业
Component({
  data: {
    selected: 0,
    color: '#8A7968',
    selectedColor: '#FF6B35',
    list: [
      {
        pagePath: '/pages/index/index',
        text: 'AI甄选'
      },
      {
        pagePath: '/pages/mystery/mystery',
        text: '盲盒惊喜'
      }
    ]
  },

  methods: {
    switchTab(e) {
      const data = e.currentTarget.dataset;
      const url = data.path;
      wx.switchTab({ url });
      this.setData({ selected: data.index });
    }
  }
});
