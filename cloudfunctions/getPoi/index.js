const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const AMAP_KEY = process.env.AMAP_KEY;

// 调用高德附近搜索接口
function amapNearby(longitude, latitude, radius) {
  const path =
    `/v3/place/around?location=${longitude},${latitude}` +
    `&types=050000&radius=${radius}&key=${AMAP_KEY}&extensions=all&offset=25`;
  const options = {
    hostname: 'restapi.amap.com',
    path,
    method: 'GET',
    timeout: 15000 // 增加到 15 秒
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

// 标准化 POI（兼容 business / biz_ext 两种返回格式）
function normalizePoi(poi) {
  const ext = poi.biz_ext || poi.business || {};
  const ratingStr = ext.rating;
  const costStr = ext.cost;
  return {
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
    const result = await amapNearby(longitude, latitude, radius);
    if (result.status !== '1') {
      return {
        status: 'error',
        message: result.info || 'AMAP error',
        infocode: result.infocode || '',
        pois: []
      };
    }
    const pois = (result.pois || []).map(normalizePoi);
    return { status: 'ok', pois };
  } catch (e) {
    console.error('getPoi error:', e.message);
    return { status: 'error', message: e.message, pois: [] };
  }
};
