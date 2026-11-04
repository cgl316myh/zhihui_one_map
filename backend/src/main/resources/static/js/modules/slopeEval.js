/**
 * 边坡状态：按位移幅值与阈值计算 warn/alarm；消警仅演示态（localStorage）。
 */

const CLEARED_KEY = 'mine-one-map-slope-cleared';

function loadCleared() {
  try {
    const raw = localStorage.getItem(CLEARED_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function saveCleared(map) {
  try {
    localStorage.setItem(CLEARED_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function getClearedSlopeMap() {
  return loadCleared();
}

export function clearSlopeAlarm(pointId, meta = {}) {
  if (!pointId) return loadCleared();
  const map = loadCleared();
  map[pointId] = {
    at: new Date().toISOString(),
    previousStatus: meta.previousStatus || 'warn',
  };
  saveCleared(map);
  return map;
}

export function revokeSlopeClear(pointId) {
  const map = loadCleared();
  delete map[pointId];
  saveCleared(map);
  return map;
}

export function resetAllSlopeClears() {
  try {
    localStorage.removeItem(CLEARED_KEY);
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * 对当前仍为 warn/alarm 的边坡点（及异常雨量）批量写入消警。
 * 与 resetAllSlopeClears（撤销全部消警记录）相反。
 */
export function clearAllActiveSlopeAlarms(slopeData) {
  const map = loadCleared();
  const now = new Date().toISOString();
  const points = Array.isArray(slopeData?.points) ? slopeData.points : [];
  points.forEach((p) => {
    if (!p?.id) return;
    const computed = p.computedStatus || computeSlopeStatus(p);
    if (computed === 'warn' || computed === 'alarm') {
      map[p.id] = {
        at: now,
        previousStatus: computed,
      };
    }
  });
  const rain = slopeData?.rainfall;
  if (rain?.id && (rain.status === 'warn' || rain.status === 'alarm')) {
    map[rain.id] = {
      at: now,
      previousStatus: rain.status,
    };
  }
  // 厂商告警若挂在 pointId 上，一并按点消警；无 pointId 的用告警 id
  (Array.isArray(slopeData?.alarms) ? slopeData.alarms : []).forEach((a) => {
    const key = a?.pointId || (a?.id != null ? `BDLX-${a.id}` : null);
    if (!key) return;
    map[key] = {
      at: now,
      previousStatus: a.level || 'warn',
    };
  });
  saveCleared(map);
  return map;
}

/** 位移幅值：取 |X|/|Y|/|H|/plane 最大绝对值 */
export function slopeMagnitude(point) {
  if (!point) return 0;
  const vals = [point.x, point.y, point.h, point.plane]
    .map((v) => Math.abs(Number(v)))
    .filter((n) => Number.isFinite(n));
  return vals.length ? Math.max(...vals) : 0;
}

export function computeSlopeStatus(point) {
  if (point?.online === false) return 'offline';
  const color = String(point?.vendorColor || '').toLowerCase();
  if (color === 'red') return 'alarm';
  if (color === 'orange' || color === 'yellow') return 'warn';
  const mag = slopeMagnitude(point);
  const warn = Number(point?.threshold?.warn);
  const alarm = Number(point?.threshold?.alarm);
  if (Number.isFinite(alarm) && mag >= alarm) return 'alarm';
  if (Number.isFinite(warn) && mag >= warn) return 'warn';
  return 'normal';
}

/**
 * 归一化边坡点：写入 computedStatus / status（考虑消警）。
 */
export function evaluateSlopePoint(point, clearedMap = loadCleared()) {
  if (!point) return point;
  const computed = computeSlopeStatus(point);
  const cleared = Boolean(clearedMap[point.id]);
  const status = cleared ? 'normal' : computed;
  return {
    ...point,
    computedStatus: computed,
    status,
    cleared,
    clearedAt: cleared ? clearedMap[point.id].at : null,
    magnitude: +slopeMagnitude(point).toFixed(2),
  };
}

export function applySlopeEvaluation(slopeData, clearedMap = loadCleared()) {
  if (!slopeData) return slopeData;
  return {
    ...slopeData,
    points: (slopeData.points || []).map((p) => evaluateSlopePoint(p, clearedMap)),
  };
}

/** 取短历史序列（Popup / 面板近端曲线） */
export function shortSeries(point, maxPts = 12) {
  const series = Array.isArray(point?.series) ? point.series : [];
  if (series.length <= maxPts) return series;
  return series.slice(-maxPts);
}
