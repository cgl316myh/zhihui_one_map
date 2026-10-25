/**
 * 储量计算（对齐资源评估常用口径）
 *
 * 可采储量 = 评估利用资源储量 × 设计回采率 × 采矿回采率
 * 采区回采率 = 采区采出量 / 采区动用储量
 * 全矿回采率 = Σ(采区回采率 × 采区采出量) / Σ(采区采出量)  （按产量加权）
 *
 * 参数由管理后台录入；大屏只读计算结果。API 模式下以数据库为准。
 */

import { isStaticHosting } from '../demoMode.js';
import { apiGet, apiPut } from '../api/client.js';

const STORAGE_KEY = 'mine-one-map-reserves-v2';

let _base = null;
let _current = null;

function clone(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

function clampRate(n, fallback = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function pct(rate) {
  return `${(Number(rate) * 100).toFixed(1)}%`;
}

function buildNext(input) {
  const next = {
    ...clone(_base || {}),
    ...clone(_current || {}),
    ...clone(input || {}),
    updatedAt: new Date().toISOString(),
  };
  // 表单 collect 不会带这些字段，必须保留库中年报快照，避免保存时冲掉 2025
  if (_current?.reportSnapshot && !next.reportSnapshot) {
    next.reportSnapshot = clone(_current.reportSnapshot);
  }
  if (_current?.dataBasis && !next.dataBasis) {
    next.dataBasis = _current.dataBasis;
  }
  if (_current?.dataBasisNote && !next.dataBasisNote) {
    next.dataBasisNote = _current.dataBasisNote;
  }

  next.districts = (Array.isArray(next.districts) ? next.districts : []).map((d, i) => ({
    id: d.id || `D${i + 1}`,
    name: String(d.name || `采区${i + 1}`).trim(),
    output: Math.max(0, Number(d.output) || 0),
    activatedReserve: Math.max(0, Number(d.activatedReserve) || 0),
  }));
  next.assessedUtilizedReserve = Math.max(0, Number(next.assessedUtilizedReserve) || 0);
  next.designRecoveryRate = clampRate(next.designRecoveryRate, 0);
  next.miningRecoveryRate = clampRate(next.miningRecoveryRate, 0);
  next.mined = Math.max(0, Number(next.mined) || 0);
  next.avgDailyMined = Math.max(0, Number(next.avgDailyMined) || 0);
  next.warningYears = Math.max(0, Number(next.warningYears) || 0);
  next.unit = next.unit || '万吨';

  const derived = computeReservesDerived(next);
  const mk = new Date().toISOString().slice(0, 7);
  const trend = Array.isArray(next.trend) ? [...next.trend] : [];
  const idx = trend.findIndex((t) => t.month === mk);
  const point = { month: mk, remaining: derived.remaining };
  if (idx >= 0) trend[idx] = point;
  else trend.push(point);
  next.trend = trend.sort((a, b) => String(a.month).localeCompare(String(b.month)));
  return next;
}

/**
 * 根据后台录入字段重算派生结果（不改动录入字段本身）
 */
export function computeReservesDerived(raw) {
  const state = clone(raw);
  const unit = state.unit || '万吨';
  const assessed = Math.max(0, Number(state.assessedUtilizedReserve) || 0);
  const designRate = clampRate(state.designRecoveryRate, 0);
  const miningRate = clampRate(state.miningRecoveryRate, 0);
  const mined = Math.max(0, Number(state.mined) || 0);
  const avgDaily = Math.max(0, Number(state.avgDailyMined) || 0);

  const recoverable = +(assessed * designRate * miningRate).toFixed(2);
  const remaining = +Math.max(0, recoverable - mined).toFixed(2);

  const districts = (Array.isArray(state.districts) ? state.districts : []).map((d, i) => {
    const output = Math.max(0, Number(d.output) || 0);
    const activated = Math.max(0, Number(d.activatedReserve) || 0);
    const rate = activated > 0 ? output / activated : 0;
    return {
      id: d.id || `D${i + 1}`,
      name: d.name || `采区${i + 1}`,
      output: +output.toFixed(2),
      activatedReserve: +activated.toFixed(2),
      recoveryRate: +rate.toFixed(6),
      recoveryRatePct: pct(rate),
    };
  });

  const sumOut = districts.reduce((s, d) => s + d.output, 0);
  const mineRate =
    sumOut > 0
      ? districts.reduce((s, d) => s + d.recoveryRate * d.output, 0) / sumOut
      : 0;

  let remainingDays = Number(state.remainingDays) || 0;
  if (avgDaily > 0) {
    remainingDays = Math.max(0, Math.round(remaining / avgDaily));
  }

  return {
    ...state,
    unit,
    assessedUtilizedReserve: +assessed.toFixed(2),
    designRecoveryRate: designRate,
    miningRecoveryRate: miningRate,
    mined: +mined.toFixed(2),
    avgDailyMined: +avgDaily.toFixed(3),
    districts,
    recoverableReserve: recoverable,
    remaining,
    initialReserve: +assessed.toFixed(2),
    designRecoverable: recoverable,
    remainingDays,
    mineRecoveryRate: +mineRate.toFixed(6),
    mineRecoveryRatePct: pct(mineRate),
    formula: {
      recoverable: '可采储量 = 评估利用资源储量 × 设计回采率 × 采矿回采率',
      district: '采区回采率 = 采区采出量 ÷ 采区动用储量',
      mine: '全矿回采率 = Σ(采区回采率 × 采区采出量) ÷ Σ(采区采出量)',
    },
  };
}

export function getReserves() {
  return computeReservesDerived(_current || {});
}

export function getReservesInput() {
  return clone(_current);
}

export function clearReservesLocalCache() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function initReserves(fileJson) {
  _base = clone(fileJson || {});
  if (!Array.isArray(_base.districts)) _base.districts = [];
  if (!Array.isArray(_base.daily)) _base.daily = [];

  // API/库表模式：以服务端为准，丢弃浏览器旧缓存，避免把 23/24 旧稿盖回库
  if (!isStaticHosting()) {
    clearReservesLocalCache();
    _current = clone(_base);
    return getReserves();
  }

  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch {
    saved = null;
  }
  if (saved) {
    _current = {
      ...clone(_base),
      ...saved,
      districts: Array.isArray(saved.districts) ? saved.districts : clone(_base.districts),
      daily: Array.isArray(saved.daily) ? saved.daily : clone(_base.daily),
      trend: Array.isArray(saved.trend) ? saved.trend : clone(_base.trend),
      forecast: Array.isArray(saved.forecast) ? saved.forecast : clone(_base.forecast),
    };
  } else {
    _current = clone(_base);
  }
  return getReserves();
}

function persistLocal(state) {
  _current = clone(state);
  if (isStaticHosting()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_current));
    } catch {
      /* ignore */
    }
  }
}

/** 仅更新内存草稿（添加/删除采区），不写库 */
export function draftReservesConfig(input) {
  const next = buildNext(input);
  persistLocal(next);
  return getReserves();
}

/**
 * 保存到数据库（PUT /api/admin/reserves）
 */
export async function saveReservesConfig(input) {
  const next = buildNext(input);
  persistLocal(next);
  if (!isStaticHosting()) {
    const r = await apiPut('/api/admin/reserves', next);
    if (!r.ok) {
      throw new Error(r.message || '储量保存失败');
    }
    if (r.data) {
      _base = clone(r.data);
      _current = clone(r.data);
    }
  }
  return getReserves();
}

/** 从服务器重新拉取 cfg_reserves */
export async function reloadReservesFromServer() {
  if (isStaticHosting()) {
    return resetReserves();
  }
  clearReservesLocalCache();
  const r = await apiGet('/api/admin/reserves');
  if (!r.ok || !r.data) {
    throw new Error(r.message || '无法从服务器加载储量');
  }
  return initReserves(r.data);
}

export function resetReserves() {
  if (!_base) return getReserves();
  clearReservesLocalCache();
  _current = clone(_base);
  return getReserves();
}

/** @deprecated 大屏不再录入；保留空实现避免旧调用报错 */
export function applyDailyMined() {
  return { ok: false, message: '日采出与储量参数请在管理后台维护' };
}

export function getTodayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatRatePct(rate) {
  return pct(rate);
}
