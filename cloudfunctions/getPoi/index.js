const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const AMAP_KEY = process.env.AMAP_KEY;

// 翻页聚合配置：单页 25 家（高德周边搜索单页上限），最多拉 4 页 ≈ 100 家。
// 自适应：仅当首页 count > PAGE_SIZE 才追加翻页，稀疏地区零额外开销。
// 详见 .trellis/tasks/06-17-poi-pool-pagination/design.md
const PAGE_SIZE = 25;
const MAX_PAGES = 4;

// 调用高德附近搜索接口（指定页码）
function amapNearbyPage(longitude, latitude, radius, page) {
  const path =
    `/v3/place/around?location=${longitude},${latitude}` +
    `&types=050000&radius=${radius}&key=${AMAP_KEY}` +
    `&extensions=all&offset=${PAGE_SIZE}&page=${page}`;
  const options = {
    hostname: 'restapi.amap.com',
    path,
    method: 'GET',
    timeout: 15000 // 单页超时 15 秒；多页并行后整体 wall time ≈ 单页耗时
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('AMAP response parse failed: ' + e.message));
        }
      });
    });
    req.on('error', (err) => {
      console.error('AMAP request error:', err);
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('AMAP request timeout after 15s'));
    });
    req.end();
  });
}

// 调用高德逆地理编码（坐标 → 地址文本）。
// 复用同一 AMAP_KEY，用于自动定位时把经纬度转成「当前位置 · xxx」的具体地址，
// 使其与手动选点（chooseLocation 返回带 address）的展示一致。
function amapRegeo(longitude, latitude) {
  const path =
    `/v3/geocode/regeo?location=${longitude},${latitude}` +
    `&key=${AMAP_KEY}&extensions=base`;
  const options = {
    hostname: 'restapi.amap.com',
    path,
    method: 'GET',
    timeout: 5000 // 仅用于显示，失败不应拖累整体 POI 拉取
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === '1' && json.regeocode) {
            resolve(json.regeocode.formatted_address || '');
          } else {
            resolve('');
          }
        } catch (e) {
          resolve(''); // 解析失败当作无地址，不抛错影响主流程
        }
      });
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => {
      req.destroy();
      resolve(''); // 超时静默放弃，保证 POI 主流程不受影响
    });
    req.end();
  });
}

// 标准化 POI（兼容 business / biz_ext 两种返回格式）
function normalizePoi(poi) {
  const ext = poi.biz_ext || poi.business || {};
  const ratingStr = ext.rating;
  const costStr = ext.cost;
  return {
    // 高德 POI 全局唯一 id，供客户端作稳定 poi_id（缺失时客户端兜底 location|name）。
    // 见 06-24-poi-id-stable：poi_id 必须稳定，禁止用数组下标。
    poi_id: poi.id || '',
    name: poi.name || '',
    address: poi.address || '',
    location: poi.location || '',
    distance: parseInt(poi.distance, 10) || 0,
    typecode: poi.typecode || '',
    type: poi.type || '',
    rating: ratingStr && ratingStr !== '' ? parseFloat(ratingStr) : null,
    cost: costStr && costStr !== '' ? parseInt(costStr, 10) : null
  };
}

exports.main = async (event) => {
  const { longitude, latitude, radius = 2000 } = event || {};
  if (longitude == null || latitude == null) {
    return { status: 'error', message: 'longitude/latitude required', pois: [] };
  }
  if (!AMAP_KEY) {
    return { status: 'error', message: 'AMAP_KEY env not set', pois: [] };
  }
  try {
    // 首页 POI 与逆地理编码并行：regeo 仅用于地址显示，尽力而为、不阻断主流程。
    const [first, regeoAddress] = await Promise.all([
      amapNearbyPage(longitude, latitude, radius, 1),
      amapRegeo(longitude, latitude)
    ]);
    if (first.status !== '1') {
      return {
        status: 'error',
        message: first.info || 'AMAP error',
        infocode: first.infocode || '',
        pois: []
      };
    }

    const totalCount = parseInt(first.count, 10) || 0;
    let allPois = [...(first.pois || [])];

    // 自适应翻页：count 超过单页容量才追加，且不超过 MAX_PAGES
    const pagesNeeded = Math.min(MAX_PAGES, Math.ceil(totalCount / PAGE_SIZE));
    if (pagesNeeded > 1) {
      const restPages = Array.from({ length: pagesNeeded - 1 }, (_, i) => i + 2);
      // 并行拉取；追加页失败则跳过（尽力而为，不影响已成功结果）
      const results = await Promise.all(
        restPages.map((page) =>
          amapNearbyPage(longitude, latitude, radius, page).catch(() => null)
        )
      );
      for (const r of results) {
        if (r && r.status === '1' && Array.isArray(r.pois)) {
          allPois.push(...r.pois);
        }
      }
    }

    // 去重：按 location|name 复合键，避免跨页重复商家进入候选池
    const seen = new Set();
    const deduped = allPois.filter((p) => {
      const key = `${p.location || ''}|${p.name || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 标准化 + 按距离升序（与"最近优先"语义一致）
    const pois = deduped
      .map(normalizePoi)
      .sort((a, b) => (a.distance || 0) - (b.distance || 0));

    return { status: 'ok', pois, address: regeoAddress || '' };
  } catch (e) {
    console.error('getPoi error:', e.message);
    return { status: 'error', message: e.message, pois: [] };
  }
};
