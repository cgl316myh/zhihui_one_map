/**
 * 传感器网关接入配置：文件默认 + localStorage 覆盖。
 * 供后台编辑；前端可读 apiBaseUrl / 轮询间隔；可导出给 gateway config.json。
 */

const STORAGE_KEY = 'mine-one-map-sensor-bridge-config-v1';

const DEFAULTS = {
  frontend: { apiBaseUrl: '', pollIntervalMs: 30000 },
  http: {
    enabled: true,
    host: '0.0.0.0',
    port: 5173,
    pushPath: '/api/push',
    staticDir: '../frontend',
  },
  tcp: {
    enabled: false,
    host: '0.0.0.0',
    port: 9000,
    frameHint: 'JSON 行 / 长度前缀（预留）',
  },
  mqtt: {
    enabled: true,
    host: '47.97.123.197',
    port: 1883,
    username: 'mqtt_test',
    password: 'test1234',
    clientId: 'mine-onemap-bridge',
    topic: '#',
    keepalive: 60,
    reconnectDelaySec: 30,
  },
  pollHintSec: 30,
};

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function deepMerge(target, src) {
  if (!src || typeof src !== 'object') return target;
  const out = { ...target };
  Object.keys(src).forEach((k) => {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
      out[k] = deepMerge(target[k] || {}, src[k]);
    } else if (src[k] !== undefined) {
      out[k] = src[k];
    }
  });
  return out;
}

function loadOverride() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getSensorConfigOverride() {
  return loadOverride();
}

export function saveSensorConfigOverride(cfg) {
  const data = clone(cfg);
  data.updatedAt = new Date().toISOString();
  // 强制安全下限
  if (data.mqtt) {
    if (Number(data.mqtt.keepalive) < 30) data.mqtt.keepalive = 30;
    if (Number(data.mqtt.reconnectDelaySec) < 30) data.mqtt.reconnectDelaySec = 30;
  }
  if (data.frontend && Number(data.frontend.pollIntervalMs) < 30000) {
    data.frontend.pollIntervalMs = 30000;
  }
  if (Number(data.pollHintSec) < 30) data.pollHintSec = 30;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

export function clearSensorConfigOverride() {
  localStorage.removeItem(STORAGE_KEY);
}

export function mergeSensorConfig(fileCfg = {}) {
  const base = deepMerge(clone(DEFAULTS), fileCfg || {});
  const ov = loadOverride();
  return ov ? deepMerge(base, ov) : base;
}

/** 导出为网关 config.json 可合并的片段（不含 frontend 专用字段也可保留） */
export function toGatewayConfigPayload(adminCfg) {
  const c = adminCfg
    ? deepMerge(clone(DEFAULTS), adminCfg)
    : mergeSensorConfig();
  // 安全下限
  if (c.mqtt) {
    c.mqtt.keepalive = Math.max(30, Number(c.mqtt.keepalive) || 60);
    c.mqtt.reconnectDelaySec = Math.max(30, Number(c.mqtt.reconnectDelaySec) || 30);
  }
  if (c.frontend) {
    c.frontend.pollIntervalMs = Math.max(
      30000,
      Number(c.frontend.pollIntervalMs) || 30000
    );
  }
  c.pollHintSec = Math.max(30, Number(c.pollHintSec) || 30);
  return {
    http: {
      enabled: c.http?.enabled !== false,
      host: c.http.host,
      port: Number(c.http.port) || 5173,
      pushPath: c.http.pushPath || '/api/push',
      staticDir: c.http.staticDir || '../frontend',
    },
    tcp: {
      enabled: Boolean(c.tcp?.enabled),
      host: c.tcp?.host || '0.0.0.0',
      port: Number(c.tcp?.port) || 9000,
      frameHint: c.tcp?.frameHint || '',
    },
    mqtt: {
      enabled: c.mqtt.enabled !== false,
      host: c.mqtt.host,
      port: Number(c.mqtt.port) || 1883,
      username: c.mqtt.username || '',
      password: c.mqtt.password || '',
      clientId: c.mqtt.clientId || 'mine-onemap-bridge',
      topic: c.mqtt.topic || '#',
      keepalive: Math.max(30, Number(c.mqtt.keepalive) || 60),
      reconnectDelaySec: Math.max(30, Number(c.mqtt.reconnectDelaySec) || 30),
    },
    pollHintSec: Math.max(30, Number(c.pollHintSec) || 30),
    frontend: {
      apiBaseUrl: c.frontend?.apiBaseUrl || '',
      pollIntervalMs: Math.max(30000, Number(c.frontend?.pollIntervalMs) || 30000),
    },
  };
}

export function downloadSensorConfigJson(cfg, filename = 'config.sensor-bridge.json') {
  const payload = toGatewayConfigPayload(cfg);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * 尝试同步到运行中的网关（可选）。
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function syncSensorConfigToGateway(cfg, baseUrl = '') {
  const url = `${(baseUrl || '').replace(/\/$/, '')}/api/config`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(toGatewayConfigPayload(cfg)),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, message: `网关 HTTP ${res.status}：${text.slice(0, 120)}` };
    }
    const json = await res.json().catch(() => ({}));
    return {
      ok: true,
      message: json.message || '已写入网关 config.json，建议重启 gateway.py 使 MQTT 重连生效',
    };
  } catch (err) {
    return {
      ok: false,
      message: `无法连接网关（${err.message || err}）。可先「导出 JSON」覆盖 sensor_bridge/config.json`,
    };
  }
}

export { DEFAULTS as SENSOR_CONFIG_DEFAULTS };
