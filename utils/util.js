function padNumber(number) {
  return number < 10 ? `0${number}` : `${number}`;
}

function formatTime(date) {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());
  const hour = padNumber(date.getHours());
  const minute = padNumber(date.getMinutes());
  const second = padNumber(date.getSeconds());

  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

function pickRandom(items) {
  if (!items.length) {
    return null;
  }

  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

// 高德 POI type 映射简化表：大类 → 用户友好词
// 仅在拿不到细分时兜底用（如 type 只有大类、或末段全是分类废话）。
const POI_TYPE_MAP = {
  '餐饮服务': '餐饮',
  '购物相关场所': '购物',
  '购物相关服务': '购物',
  '住宿服务': '住宿',
  '风景名胜': '景点',
  '风景名胜相关场所': '景点',
  '体育休闲服务': '休闲',
  '体育休闲服务场所': '休闲',
  '医疗保健服务': '医疗',
  '交通设施服务': '交通',
  '公共设施': '公共设施',
  '商务住宅': '住宅',
  '政府机构及社会团体': '机构',
  '科教文化服务': '文教',
  '金融保险服务': '金融',
  '公司企业': '公司',
  '地名地址信息': '地址',
  '汽车维修': '汽修',
  '汽车服务': '汽车服务',
  '事件活动': '活动'
};

// 高德分类串里的"废话段"：这些段是分类层级词，不是具体业态
// （如"餐饮相关场所""购物相关服务"），对用户毫无辨识度，必须跳过。
const POI_TYPE_NOISE_SEGMENTS = new Set([
  '餐饮服务', '餐饮相关场所', '餐饮相关购物服务', '餐饮相关购物服务场所',
  '购物服务', '购物相关场所', '购物相关服务',
  '住宿服务', '风景名胜', '风景名胜相关场所',
  '体育休闲服务', '体育休闲服务场所',
  '医疗保健服务', '交通设施服务', '公共设施', '商务住宅',
  '政府机构及社会团体', '科教文化服务', '金融保险服务',
  '公司企业', '地名地址信息', '事件活动'
]);

// 把高德多级分类清洗为单一可读分类。
// 策略：从最细段（末段）往前找，跳过"相关场所/相关服务"这类分类废话段，
// 取第一个有实质意义的细分（如"中式快餐""茶餐厅""中餐厅"）。
// 拿不到细分时，回退到首段大类映射（如"餐饮服务"→"餐饮"）。
//
// 这修复了"推荐列表所有店铺 type 都显示为餐饮"的问题：
// 旧实现只取首段并映射成大类，把"中餐厅;中式快餐"这种有用的细分全丢了。
function normalizePoiType(rawType) {
  if (!rawType || typeof rawType !== 'string') return '餐饮';
  const segs = rawType.split(';').map((s) => s.trim()).filter(Boolean);
  if (segs.length === 0) return '餐饮';

  // 优先：从末段往前找第一个非废话段（即最具体的业态）
  for (let i = segs.length - 1; i >= 0; i--) {
    if (!POI_TYPE_NOISE_SEGMENTS.has(segs[i])) {
      return segs[i];
    }
  }

  // 兜底：全是废话段，回退首段大类映射
  return POI_TYPE_MAP[segs[0]] || segs[0];
}

module.exports = {
  formatTime,
  pickRandom,
  normalizePoiType
};
