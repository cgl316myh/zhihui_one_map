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

/** 位移幅值：取 |X|/|Y|/|H|/plane 最大绝对值 */
export function slopeMagnitude(point) {
  if (!point) return 0;
  const vals = [point.x, point.y, point.h, point.plane]
    .map((v) => Math.abs(Number(v)))
    .filter((n) => Number.isFinite(n));
  return vals.length ? Math.max(...vals) : 0;
}

export function computeSlopeStatus(point) {
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
