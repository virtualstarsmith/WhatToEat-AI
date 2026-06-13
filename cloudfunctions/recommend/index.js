const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const GLM_API_KEY = process.env.GLM_API_KEY;
const GLM_MODEL = process.env.GLM_MODEL || 'hy3-preview';

// 场景关键词表（源自 .trellis/tasks/06-10-wechat-miniprogram-template/design.md §5.3）
// null 表示全部品类等权（multiplier = 1.0）
const SCENE_KEYWORDS = {
  '早餐': ['早餐', '包子', '粥', '豆浆', '油条', '肠粉', '面', '粉'],
  '午餐': ['快餐', '简餐', '面食', '粉', '便当', '盖饭'],
  '下午茶/饮品': ['奶茶', '咖啡', '甜品', '烘焙', '果汁', '茶饮', '轻食'],
  '晚餐': ['正餐', '火锅', '烧烤', '炒菜', '饭店'],
  '夜宵': ['烧烤', '小龙虾', '粥', '串', '烤', '宵夜'],
  '随便吃点': null
};

// ===== 评分相关 =====

function distanceScore(distance) {
  // 指数衰减，800m 约步行 10 分钟
  return Math.exp(-distance / 800);
}

function qualityScore(rating) {
  // 无评分给 0.3（降权而非中位数）
  return rating ? rating / 5.0 : 0.3;
}

function sceneMultiplier(scene, poi) {
  const keywords = SCENE_KEYWORDS[scene];
  if (!keywords) return 1.0; // 随便吃点 / 未知场景
  const haystack = (poi.name || '') + (poi.type || '') + (poi.typecode || '');
  return keywords.some((k) => haystack.indexOf(k) >= 0) ? 1.0 : 0.5;
}

function scoreCandidates(pois, scene, excludeIds) {
  const excludeSet = new Set((excludeIds || []).map(String));
  return pois.map((poi, idx) => {
    const base = 0.5 * distanceScore(poi.distance) + 0.5 * qualityScore(poi.rating);
    const mult = sceneMultiplier(scene, poi);
    let score = base * mult;
    const poiId = String(idx);
    if (excludeSet.has(poiId)) score *= 0.6;
    return { poi_id: poiId, poi, score };
  });
}

function topN(scored, n) {
  return [...scored].sort((a, b) => b.score - a.score).slice(0, n);
}

// ===== GLM 调用 =====

function callGlm(scene, candidates) {
  const userMessages = [
    {
      role: 'system',
      content:
        '你是餐饮推荐助手，根据用户用餐场景和附近商家信息，从候选列表中推荐 1-3 家。' +
        '必须严格返回 JSON，格式：{"recommendations":[{"poi_id":"字符串","reason":"一句话理由"}]}。' +
        'poi_id 必须来自候选列表，理由 25 字以内、自然口语化、不要废话开场白。'
    },
    {
      role: 'user',
      content: JSON.stringify({
        scene,
        candidates: candidates.map((c) => ({
          poi_id: c.poi_id,
          name: c.poi.name,
          type: c.poi.type,
          distance: c.poi.distance,
          rating: c.poi.rating,
          cost: c.poi.cost
        }))
      })
    }
  ];

  // 尝试标准OpenAI格式
  const body = JSON.stringify({
    model: GLM_MODEL,
    messages: userMessages,
    response_format: { type: 'json_object' },
    temperature: 0.7,
    stream: false
  });

  const options = {
    hostname: 'cloud1-d9g9rlmpp3a746cac.api.tcloudbasegateway.com',
    path: '/v1/ai/cloudbase',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': `Bearer ${GLM_API_KEY}`
    },
    timeout: 8000
  };

  console.log('腾讯云API调用详情:');
  console.log('Hostname:', options.hostname);
  console.log('Path:', options.path);
  console.log('Model:', GLM_MODEL);
  console.log('Messages count:', userMessages.length);

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('腾讯云API响应状态:', res.statusCode);
        console.log('腾讯云API响应头:', JSON.stringify(res.headers));
        console.log('腾讯云API响应数据:', data);
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          console.error('GLM response parse failed:', e.message);
          console.error('Response data:', data);
          reject(new Error('GLM response parse failed: ' + e.message));
        }
      });
    });
    req.on('error', (err) => {
      console.error('GLM request error:', err);
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GLM request timeout after 8s'));
    });
    req.write(body);
    req.end();
  });
}

// ===== 兜底 =====

// 生成推荐理由（模板化）
function generateReason(poi, scene) {
  const distance = poi.distance || 0;
  const distanceText = distance >= 1000 ?
    Math.round(distance / 1000) + '公里' :
    Math.round(distance) + '米';

  const rating = poi.rating;
  const ratingText = rating ? rating.toFixed(1) + '分' : '好评';

  const type = poi.type || '餐饮';

  // 根据不同场景和属性生成推荐理由
  if (rating && rating >= 4.5 && distance < 500) {
    return `这家店评分${ratingText}，距离仅${distanceText}，非常值得尝试`;
  } else if (rating && rating >= 4.5) {
    return `虽然距离${distanceText}，但评分高达${ratingText}，值得一去`;
  } else if (rating && rating >= 4.0) {
    return `距离${distanceText}，评分${ratingText}，性价比不错`;
  } else if (distance < 300) {
    return `距离仅${distanceText}，很近便，${ratingText}的${type}`;
  } else {
    return `${ratingText}的${type}，距离${distanceText}，符合${scene}需求`;
  }
}

function buildFallback(scored, scene) {
  return topN(scored, 3).map((item) => ({
    poi_id: item.poi_id,
    poi: item.poi,
    reason: generateReason(item.poi, scene) // 使用模板生成推荐理由
  }));
}

// ===== Handler =====

exports.main = async (event) => {
  const { pois = [], scene = '随便吃点', excludeIds = [] } = event || {};
  if (!Array.isArray(pois) || pois.length === 0) {
    return {
      status: 'error',
      message: 'pois required and non-empty',
      source: 'fallback',
      recommendations: []
    };
  }

  const scored = scoreCandidates(pois, scene, excludeIds);
  const candidates = topN(scored, 7); // 优化：从15个减少到7个，平衡推荐质量和响应速度
  const candidateMap = new Map(candidates.map((c) => [c.poi_id, c]));

  // 无 key 直接兜底
  if (!GLM_API_KEY) {
    return {
      status: 'ok',
      source: 'fallback',
      message: 'GLM_API_KEY not set',
      recommendations: buildFallback(scored, scene)
    };
  }

  try {
    const result = await callGlm(scene, candidates);

    // 适配多种API响应格式
    let message = null;

    // 格式1: 标准OpenAI格式 { choices: [{ message: { content: "..." } }] }
    if (result && result.choices && result.choices[0] && result.choices[0].message) {
      message = result.choices[0].message;
    }
    // 格式2: 腾讯云格式 { data: { choices: [{ message: { content: "..." } }] } }
    else if (result && result.data && result.data.choices && result.data.choices[0] && result.data.choices[0].message) {
      message = result.data.choices[0].message;
    }
    // 格式3: 其他可能的嵌套格式
    else if (result && result.data && result.data.response && result.data.response.choices && result.data.response.choices[0]) {
      message = result.data.response.choices[0].message || result.data.response.choices[0];
    }

    if (!message || !message.content) {
      console.error('GLM response structure:', JSON.stringify(result, null, 2));
      throw new Error('GLM response missing message content');
    }
    let parsed;
    try {
      parsed = JSON.parse(message.content);
    } catch (e) {
      throw new Error('GLM content not valid JSON: ' + e.message);
    }
    const raw = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
    const valid = raw
      .filter((r) => r && typeof r.poi_id === 'string' && candidateMap.has(r.poi_id))
      .slice(0, 3)
      .map((r) => ({
        poi_id: r.poi_id,
        poi: candidateMap.get(r.poi_id).poi,
        reason: typeof r.reason === 'string' ? r.reason : ''
      }));

    if (valid.length === 0) {
      console.warn('GLM returned no valid recommendations, fallback');
      return {
        status: 'ok',
        source: 'fallback',
        message: 'GLM no valid recommendations',
        recommendations: buildFallback(scored, scene)
      };
    }
    return { status: 'ok', source: 'ai', recommendations: valid };
  } catch (e) {
    console.error('GLM call failed, fallback:', e.message);
    return {
      status: 'ok',
      source: 'fallback',
      message: e.message,
      recommendations: buildFallback(scored, scene)
    };
  }
};
