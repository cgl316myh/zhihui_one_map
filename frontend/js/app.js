import { loadDashboardBundle } from './api/dashboard.js';
import { apiGet } from './api/client.js';
import {
  startSlopePolling,
  getSlopeApiConfig,
  stopSlopePolling,
  configureSlopeApi,
} from './api/slope.js';
import {
  configureSensorApi,
} from './api/sensors.js';
import {
  initMap,
  setLayerVisible,
  renderEnvironmentMarkers,
  renderVideoMarkers,
  renderProductionMarkers,
  renderSlopeMarkers,
  focusSlopePoint,
  invalidateMapSize,
} from './modules/map.js';
import {
  renderEnvironment,
  renderEnvThresholdForm,
  renderProduction,
  renderAlerts,
  renderSlopePanel,
  renderReserves,
  renderVideo,
  setSlopePollStatus,
  setEnvPollStatus,
} from './modules/panels.js';
import { buildAlertsFromMock } from './modules/alerts.js';
import {
  initEnvThresholds,
  applyEnvThresholds,
  getEnvThresholds,
  getActivePeriodKey,
} from './modules/envThresholds.js';
import {
  applySlopeEvaluation,
  clearSlopeAlarm,
  revokeSlopeClear,
  resetAllSlopeClears,
} from './modules/slopeEval.js';
import {
  initReserves,
  getReserves,
} from './modules/reserves.js';
import { initRoleFromSession, roleLabel, isAdmin } from './modules/role.js';
import { requireSession, logout, getSession } from './auth/session.js';
import { appendAuditLog } from './auth/audit.js';
import { initUserStore } from './auth/users.js';
import { initDictStore } from './auth/dict.js';
import { mergeMapConfig } from './auth/mapConfigStore.js';
import { mergeSensorConfig } from './auth/sensorConfigStore.js';
import { initResizableSidebars, focusWorkspacePanel } from './modules/layout.js';
import { initMapToolbar } from './modules/tools.js';

let mockData = null;
let selectedSlopeId = null;
let selectedEnvId = null;
let rawSlopeData = null;
let currentSession = null;

function tickClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  el.textContent = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function bindLayerToggles() {
  document.querySelectorAll('[data-layer]').forEach((input) => {
    input.addEventListener('change', () => {
      setLayerVisible(input.dataset.layer, input.checked);
    });
  });
}

function bindSlopeListClicks() {
  const list = document.getElementById('panel-slope-list');
  if (!list) return;
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-slope-id]');
    if (!btn) return;
    selectedSlopeId = btn.dataset.slopeId;
    const last = window.__lastSlopeData;
    if (last) {
      renderSlopePanel(last, selectedSlopeId, slopeActionHandlers());
      focusSlopePoint(selectedSlopeId);
    }
  });
}

function bindEnvListClicks() {
  const box = document.getElementById('panel-environment');
  if (!box) return;
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-env-id]');
    if (!btn || !mockData?.environment) return;
    selectedEnvId = btn.dataset.envId;
    selectedEnvId = renderEnvironment(mockData.environment, selectedEnvId);
  });
}

function showNavToast(message) {
  let el = document.getElementById('nav-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'nav-toast';
    el.className = 'nav-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('is-show');
  clearTimeout(showNavToast._timer);
  showNavToast._timer = setTimeout(() => {
    el.classList.remove('is-show');
  }, 2200);
}

function bindNavTabs() {
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.scroll;
      if (!target) return;
      const label = (tab.textContent || '').trim() || '该';
      const result = focusWorkspacePanel(target);
      if (result.expanded) {
        showNavToast(`已展开侧栏并定位到「${label}」`);
      } else if (result.alreadyVisible) {
        showNavToast(`当前已在「${label}」模块`);
      }
    });
  });
}

function syncUserUI() {
  const tag = document.getElementById('user-tag');
  if (tag) tag.textContent = roleLabel(currentSession || getSession());
  const adminLink = document.getElementById('link-admin');
  if (adminLink) adminLink.hidden = !isAdmin();
}

function setUserMenuOpen(open) {
  const root = document.getElementById('user-menu');
  const btn = document.getElementById('user-menu-btn');
  const panel = document.getElementById('user-menu-panel');
  if (!root || !btn || !panel) return;
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  root.classList.toggle('is-open', open);
}

function bindUserMenu() {
  const root = document.getElementById('user-menu');
  const btn = document.getElementById('user-menu-btn');
  const panel = document.getElementById('user-menu-panel');
  if (!root || !btn || !panel) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setUserMenuOpen(panel.hidden);
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => setUserMenuOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setUserMenuOpen(false);
  });
}

function bindLogout() {
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    setUserMenuOpen(false);
    const s = getSession();
    appendAuditLog({
      actor: s?.username || 'anonymous',
      action: 'logout',
      result: 'ok',
      summary: '退出登录',
    });
    logout('./login.html');
  });
}

function refreshEnvironment() {
  if (!mockData?.environment) return;
  mockData.environment = applyEnvThresholds(mockData.environment, getEnvThresholds());
  selectedEnvId = renderEnvironment(mockData.environment, selectedEnvId);
  renderEnvironmentMarkers(mockData.environment);
  refreshAlerts();
  const period = getActivePeriodKey() === 'day' ? '昼间' : '夜间';
  setEnvPollStatus(true, `${period}阈值生效`);
}

function refreshThresholdForm() {
  renderEnvThresholdForm();
}

function refreshReservesPanel() {
  const reserves = getReserves();
  mockData.reserves = reserves;
  renderReserves(reserves);
}

function refreshAlerts(slopeOverride) {
  if (!mockData) return;
  const alerts = buildAlertsFromMock({
    environment: mockData.environment,
    slope: slopeOverride || window.__lastSlopeData,
    production: mockData.production,
    video: mockData.video,
  });
  mockData.alerts = alerts;
  renderAlerts(alerts);
}

function slopeActionHandlers() {
  return {
    onClear: (id, previousStatus) => {
      clearSlopeAlarm(id, { previousStatus });
      if (rawSlopeData) applySlope(rawSlopeData);
    },
    onRevoke: (id) => {
      revokeSlopeClear(id);
      if (rawSlopeData) applySlope(rawSlopeData);
    },
    onResetClears: () => {
      resetAllSlopeClears();
      if (rawSlopeData) applySlope(rawSlopeData);
    },
  };
}

function applySlope(data) {
  if (!data) return;
  rawSlopeData = data;
  const evaluated = applySlopeEvaluation(data);
  window.__lastSlopeData = evaluated;
  selectedSlopeId =
    renderSlopePanel(evaluated, selectedSlopeId, slopeActionHandlers()) ||
    selectedSlopeId;
  if (mockData?.slopePoints) {
    renderSlopeMarkers(evaluated, mockData.slopePoints.points || []);
  }
  refreshAlerts(evaluated);
}

function onSlopeData(data) {
  applySlope(data);
  const cfg = getSlopeApiConfig();
  let statusText;
  if (data.unavailable) {
    statusText = '边坡监测 · 网关不可用';
  } else if (!data.live) {
    statusText = `边坡监测 · 等待推送 · ${Math.round(cfg.intervalMs / 1000)}s`;
  } else {
    statusText = `边坡实时 · ${Math.round(cfg.intervalMs / 1000)}s 读取`;
  }
  setSlopePollStatus(Boolean(data.live), statusText);
}

function onSlopeError(err) {
  setSlopePollStatus(false, `边坡刷新失败，保留上次数据 · ${err.message || err}`);
}

async function boot() {
  await initUserStore();
  initDictStore();
  currentSession = requireSession('./login.html');
  if (!currentSession) return;

  initRoleFromSession(currentSession);
  syncUserUI();
  bindUserMenu();
  bindLogout();

  tickClock();
  setInterval(tickClock, 1000);
  bindLayerToggles();
  bindSlopeListClicks();
  bindEnvListClicks();
  bindNavTabs();
  initResizableSidebars();

  try {
    mockData = await loadDashboardBundle();
  } catch (err) {
    console.error(err);
    document.getElementById('boot-error').hidden = false;
    document.getElementById('boot-error').textContent =
      '数据加载失败，请确认 Spring Boot 已启动且已登录（数据仅来自数据库/接口，无演示回退）。';
    return;
  }

  initEnvThresholds(mockData.envThresholds);
  initReserves(mockData.reserves);

  const center = mockData.slopePoints?.mapCenter ||
    mockData.publicConfig?.mapCenter ||
    [102.445768, 24.786112];
  const zoom = mockData.slopePoints?.mapZoom ?? mockData.publicConfig?.mapZoom ?? 15;
  initMap(center, zoom);

  let mapConfig = { defaultBasemap: 'google-sat', ...(mockData.publicConfig || {}) };
  mapConfig = mergeMapConfig(mapConfig);
  try {
    initMapToolbar(mapConfig);
  } catch (err) {
    console.error('[toolbar]', err);
  }

  const sensorCfg = mergeSensorConfig({
    frontend: {
      pollIntervalMs: Number(mockData.publicConfig?.pollIntervalMs) || 30000,
    },
  });
  // API 模式：相对路径 /api 经 Vite 代理到 Spring
  const apiBase = '';
  const pollMs = Math.max(30000, Number(sensorCfg.frontend?.pollIntervalMs) || 30000);
  configureSensorApi({ baseUrl: apiBase, intervalMs: pollMs });
  configureSlopeApi({
    baseUrl: apiBase,
    intervalMs: pollMs,
    preferMock: false,
  });

  requestAnimationFrame(() => {
    invalidateMapSize();
  });

  refreshEnvironment();
  refreshThresholdForm();
  renderProduction(mockData.production);
  refreshReservesPanel();
  renderVideo(mockData.video);
  renderVideoMarkers(mockData.video);
  renderProductionMarkers(mockData.production, mockData.slopePoints);

  ['environment', 'slope', 'video', 'production'].forEach((k) => setLayerVisible(k, true));

  startSlopePolling(onSlopeData, onSlopeError);

  window.__sensorDebug = {
    stop: () => {
      stopSlopePolling();
    },
  };
}

boot();
