/**
 * 环境阈值：默认读 mock JSON，演示改动能写入 localStorage。
 */

const STORAGE_KEY = 'mine-one-map-env-thresholds';

const DEFAULTS = {
  updatedAt: null,
  dayHours: [6, 22],
  day: {
    noise: { warn: 65, alarm: 75, unit: 'dB' },
    pm25: { warn: 55, alarm: 75, unit: 'μg/m³' },
    pm10: { warn: 80, alarm: 150, unit: 'μg/m³' },
    dust: { warn: 1.5, alarm: 3.0, unit: 'mg/m³' },
  },
  night: {
    noise: { warn: 55, alarm: 65, unit: 'dB' },
    pm25: { warn: 45, alarm: 65, unit: 'μg/m³' },
    pm10: { warn: 70, alarm: 120, unit: 'μg/m³' },
    dust: { warn: 1.0, alarm: 2.0, unit: 'mg/m³' },
  },
};

let _base = structuredClone(DEFAULTS);
let _current = structuredClone(DEFAULTS);

function deepMerge(target, src) {
  if (!src || typeof src !== 'object') return target;
  const out = { ...target };
  Object.keys(src).forEach((k) => {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
      out[k] = deepMerge(target[k] || {}, src[k]);
    } else {
      out[k] = src[k];
    }
  });
  return out;
}

export function getEnvThresholds() {
  return structuredClone(_current);
}

export function getDefaultEnvThresholds() {
  return structuredClone(_base);
}

export function isDayPeriod(date = new Date(), thresholds = _current) {
  const [start, end] = thresholds.dayHours || [6, 22];
  const h = date.getHours();
  return h >= start && h < end;
}

export function getActivePeriodKey(date = new Date(), thresholds = _current) {
  return isDayPeriod(date, thresholds) ? 'day' : 'night';
}

/**
 * 按当前时段阈值重算点位 status（不改 metrics）。
 */
export function evaluateEnvPoint(point, thresholds = _current, date = new Date()) {
  if (!point) return point;
  const period = getActivePeriodKey(date, thresholds);
  const rules = thresholds[period] || thresholds.day || {};
  const m = point.metrics || {};
  let status = 'normal';
  let hit = null;

  ['noise', 'pm25', 'pm10', 'dust'].forEach((key) => {
    const v = m[key];
    const rule = rules[key];
    if (v == null || !rule) return;
    if (rule.alarm != null && v >= rule.alarm) {
      status = 'alarm';
      hit = { key, value: v, level: 'alarm', limit: rule.alarm };
    } else if (status !== 'alarm' && rule.warn != null && v >= rule.warn) {
      status = 'warn';
      hit = { key, value: v, level: 'warn', limit: rule.warn };
    }
  });

  return {
    ...point,
    status,
    statusHit: hit,
    thresholdPeriod: period,
  };
}

export function applyEnvThresholds(env, thresholds = _current, date = new Date()) {
  if (!env) return env;
  return {
    ...env,
    points: (env.points || []).map((p) => evaluateEnvPoint(p, thresholds, date)),
  };
}

export function loadEnvThresholdsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveEnvThresholds(partial) {
  _current = deepMerge(_current, partial || {});
  _current.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_current));
  } catch {
    /* ignore */
  }
  return getEnvThresholds();
}

export function resetEnvThresholds() {
  _current = structuredClone(_base);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return getEnvThresholds();
}

/**
 * @param {object} fileJson mock 文件内容
 */
export function initEnvThresholds(fileJson) {
  _base = deepMerge(DEFAULTS, fileJson || {});
  const saved = loadEnvThresholdsFromStorage();
  _current = saved ? deepMerge(_base, saved) : structuredClone(_base);
  return getEnvThresholds();
}
