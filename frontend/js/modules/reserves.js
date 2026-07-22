/**
 * 储量：本地 mock + localStorage 覆盖；日采出录入与简单扣减。
 * 公式（演示）：
 *   remaining = remaining - minedToday
 *   mined = mined + minedToday
 *   当月 trend 末点同步；remainingDays ≈ remaining / 近 N 日均采出
 */

const STORAGE_KEY = 'mine-one-map-reserves';

let _base = null;
let _current = null;

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function monthKey(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function getReserves() {
  return clone(_current);
}

export function initReserves(fileJson) {
  _base = clone(fileJson || {});
  if (!Array.isArray(_base.daily)) _base.daily = [];
  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch {
    saved = null;
  }
  _current = saved ? { ...clone(_base), ...saved, daily: saved.daily || clone(_base.daily) } : clone(_base);
  // 合并：保留 base 字段缺省
  _current.unit = _current.unit || _base.unit;
  _current.warningYears = _current.warningYears ?? _base.warningYears;
  _current.lossRate = _current.lossRate ?? _base.lossRate;
  return getReserves();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_current));
  } catch {
    /* ignore */
  }
}

function recomputeRemainingDays(state) {
  const daily = (state.daily || []).filter((d) => Number(d.mined) > 0).slice(-14);
  const avg =
    daily.length > 0
      ? daily.reduce((s, d) => s + Number(d.mined), 0) / daily.length
      : 0.35;
  if (avg <= 0) return state.remainingDays;
  return Math.max(0, Math.round(Number(state.remaining) / avg));
}

function syncMonthTrend(state, dateStr, remaining) {
  const mk = monthKey(dateStr);
  if (!mk) return;
  const trend = Array.isArray(state.trend) ? [...state.trend] : [];
  const idx = trend.findIndex((t) => t.month === mk);
  if (idx >= 0) {
    trend[idx] = { ...trend[idx], remaining: +Number(remaining).toFixed(1) };
  } else {
    trend.push({ month: mk, remaining: +Number(remaining).toFixed(1) });
    trend.sort((a, b) => String(a.month).localeCompare(String(b.month)));
  }
  state.trend = trend;
}

/**
 * 录入/覆盖某日采出量（万吨），并扣减储量。
 * 若该日已有记录，先回滚旧值再写入新值。
 * @returns {{ ok: boolean, message?: string, reserves?: object }}
 */
export function applyDailyMined({ date, mined, note } = {}) {
  if (!_current) return { ok: false, message: '储量未初始化' };
  const dateStr = date || todayStr();
  const amount = Number(mined);
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { ok: false, message: '日期格式应为 YYYY-MM-DD' };
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, message: '采出量须为非负数' };
  }

  const state = clone(_current);
  const daily = Array.isArray(state.daily) ? [...state.daily] : [];
  const existIdx = daily.findIndex((d) => d.date === dateStr);
  const prev = existIdx >= 0 ? Number(daily[existIdx].mined) || 0 : 0;
  const delta = amount - prev;

  let remaining = Number(state.remaining) - delta;
  let minedTotal = Number(state.mined) + delta;
  if (remaining < 0) {
    return { ok: false, message: `扣减后剩余为负（需 ${delta.toFixed(2)}，剩余 ${state.remaining}）` };
  }

  remaining = +remaining.toFixed(2);
  minedTotal = +minedTotal.toFixed(2);

  const row = { date: dateStr, mined: +amount.toFixed(3), note: note || '' };
  if (existIdx >= 0) daily[existIdx] = row;
  else daily.push(row);
  daily.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  state.daily = daily;
  state.remaining = remaining;
  state.mined = minedTotal;
  state.updatedAt = new Date().toISOString();
  syncMonthTrend(state, dateStr, remaining);
  state.remainingDays = recomputeRemainingDays(state);

  _current = state;
  persist();
  return { ok: true, reserves: getReserves() };
}

export function resetReserves() {
  if (!_base) return getReserves();
  _current = clone(_base);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return getReserves();
}

export function getTodayStr() {
  return todayStr();
}
