/**
 * 边坡监测数据接口层。
 * 仅请求 /api/slope（经 Spring 代理 bridge），失败不回退本地演示 JSON。
 * 轮询间隔 ≥ 30 秒。
 */
const SLOPE_API = {
  baseUrl: '',
  path: '/api/slope',
  preferMock: false,
  intervalMs: 30_000,
};

let _timer = null;
let _lastData = null;

function slopeUrl() {
  const base = SLOPE_API.baseUrl.replace(/\/$/, '');
  const path = SLOPE_API.path.startsWith('/') ? SLOPE_API.path : `/${SLOPE_API.path}`;
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
    unavailable: Boolean(raw.unavailable),
    live: Boolean(raw.live),
  };
}

function unwrapApiPayload(json) {
  if (json && typeof json === 'object' && 'code' in json && 'data' in json) {
    if (json.code !== 0) throw new Error(json.message || '边坡接口错误');
    return json.data;
  }
  return json;
}

export async function fetchSlopeData() {
  if (SLOPE_API.preferMock) {
    throw new Error('已禁用演示数据，请关闭 preferMock 并连接后端');
  }
  const token =
    sessionStorage.getItem('mine-one-map-session-v1') ||
    localStorage.getItem('mine-one-map-session-v1');
  let access = '';
  try {
    access = token ? JSON.parse(token).accessToken || '' : '';
  } catch {
    access = '';
  }
  const headers = { Accept: 'application/json' };
  if (access) headers.Authorization = `Bearer ${access}`;
  const res = await fetch(slopeUrl(), { method: 'GET', cache: 'no-store', headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = normalizeSlopePayload(unwrapApiPayload(await res.json()));
  _lastData = data;
  return data;
}

export function getLastSlopeData() {
  return _lastData;
}

export function getSlopeApiConfig() {
  return { ...SLOPE_API };
}

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
  // 强制禁止演示回退
  SLOPE_API.preferMock = false;
}
