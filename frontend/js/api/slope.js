/**
 * 边坡监测数据接口层。
 * 演示原型默认 preferMock：直接读本地 slope.json；保留 /api/slope 形状供后续接入。
 * 轮询间隔 ≥ 30 秒。
 */
const SLOPE_API = {
  baseUrl: '',
  path: '/api/slope',
  fallbackUrl: './data/slope.json',
  /** 演示原型：优先本地 mock，不连真实网关 */
  preferMock: true,
  intervalMs: 30_000,
};

let _timer = null;
let _lastData = null;

function slopeUrl() {
  const base = SLOPE_API.baseUrl.replace(/\/$/, '');
  const path = SLOPE_API.path.startsWith('/') ? SLOPE_API.path : `/${SLOPE_API.path}`;
  // 加时间戳避免浏览器缓存，便于演示「定时刷新」
  return `${base}${path}?_=${Date.now()}`;
}

/**
 * 归一化为前端统一 DTO
 */
function normalizeSlopePayload(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('边坡数据格式无效');
  }
  return {
    updatedAt: raw.updatedAt || new Date().toISOString(),
    source: raw.source || '',
    sourceUrl: raw.sourceUrl || '',
    projectName: raw.projectName || '',
    rainfall: raw.rainfall || null,
    points: Array.isArray(raw.points) ? raw.points : [],
  };
}

async function fetchJson(u) {
  const res = await fetch(u, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 拉取边坡数据（统一接口入口）
 * @returns {Promise<object>}
 */
export async function fetchSlopeData() {
  let json;
  const fb = SLOPE_API.fallbackUrl;
  if (SLOPE_API.preferMock && fb) {
    json = await fetchJson(`${fb}?_=${Date.now()}`);
  } else {
    try {
      json = await fetchJson(slopeUrl());
    } catch (err) {
      if (!fb) throw err;
      json = await fetchJson(`${fb}?_=${Date.now()}`);
    }
  }
  const data = normalizeSlopePayload(json);
  data.live = Boolean(json.live) && !SLOPE_API.preferMock;
  _lastData = data;
  return data;
}

export function getLastSlopeData() {
  return _lastData;
}

export function getSlopeApiConfig() {
  return { ...SLOPE_API };
}

/**
 * 立即拉取一次，并按 intervalMs 定时轮询
 */
export function startSlopePolling(onData, onError) {
  stopSlopePolling();

  const tick = async () => {
    try {
      const data = await fetchSlopeData();
      if (typeof onData === 'function') onData(data);
    } catch (err) {
      console.warn('[slope] 刷新失败，保留上次数据', err);
      if (typeof onError === 'function') onError(err, _lastData);
    }
  };

  tick();
  _timer = setInterval(tick, SLOPE_API.intervalMs);
  return () => stopSlopePolling();
}

export function stopSlopePolling() {
  if (_timer != null) {
    clearInterval(_timer);
    _timer = null;
  }
}

/** 允许页面或调试时改配置；间隔不得低于 30 秒 */
export function configureSlopeApi(partial) {
  Object.assign(SLOPE_API, partial || {});
  if (SLOPE_API.intervalMs < 30_000) {
    SLOPE_API.intervalMs = 30_000;
  }
}
