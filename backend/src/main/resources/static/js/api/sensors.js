/**
 * 传感器网关只读接口（MQTT + HTTP 推送汇聚后）
 * 轮询间隔固定 ≥ 30 秒，勿把心跳/轮询设得过短。
 */
const SENSOR_API = {
  /** 网关基址：同域时空字符串；独立静态服务时可改 http://127.0.0.1:5173 */
  baseUrl: '',
  latestPath: '/api/sensors/latest',
  environmentPath: '/api/environment',
  slopePath: '/api/slope',
  statusPath: '/api/status',
  /** 读取间隔：30 秒 */
  intervalMs: 30_000,
};

let _timer = null;
let _lastBundle = null;

function url(path) {
  const base = (SENSOR_API.baseUrl || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}?_=${Date.now()}`;
}

export function getSensorApiConfig() {
  return { ...SENSOR_API };
}

export function configureSensorApi(partial) {
  Object.assign(SENSOR_API, partial || {});
  // 强制不低于 30 秒
  if (SENSOR_API.intervalMs < 30_000) {
    SENSOR_API.intervalMs = 30_000;
  }
}

export function getLastSensorBundle() {
  return _lastBundle;
}

export async function fetchSensorLatest() {
  const res = await fetch(url(SENSOR_API.latestPath), {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`传感器接口 HTTP ${res.status}`);
  }
  const json = await res.json();
  _lastBundle = json;
  return json;
}

export async function fetchEnvironmentLive() {
  const res = await fetch(url(SENSOR_API.environmentPath), {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`环境接口 HTTP ${res.status}`);
  return res.json();
}

/**
 * 立即拉一次，并按 30s 轮询。
 */
export function startSensorPolling(onData, onError) {
  stopSensorPolling();

  const tick = async () => {
    try {
      const data = await fetchSensorLatest();
      if (typeof onData === 'function') onData(data);
    } catch (err) {
      console.warn('[sensors] 刷新失败，保留上次数据', err);
      if (typeof onError === 'function') onError(err, _lastBundle);
    }
  };

  tick();
  _timer = setInterval(tick, SENSOR_API.intervalMs);
  return () => stopSensorPolling();
}

export function stopSensorPolling() {
  if (_timer != null) {
    clearInterval(_timer);
    _timer = null;
  }
}
