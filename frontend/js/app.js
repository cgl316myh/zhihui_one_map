import { loadMockBundle } from './api/mock.js';
import {
  startSlopePolling,
  getSlopeApiConfig,
  stopSlopePolling,
} from './api/slope.js';
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
  saveEnvThresholds,
  resetEnvThresholds,
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
  applyDailyMined,
  resetReserves,
  getReserves,
} from './modules/reserves.js';
import { initRole, setRole, getRole, roleLabel } from './modules/role.js';
import { initResizableSidebars } from './modules/layout.js';
import { initMapToolbar } from './modules/tools.js';

/** 演示原型：环境/边坡/报警均以本地 mock 为准，不接真实 MQTT/HTTP */
const DEMO_MOCK_ONLY = true;

let mockData = null;
let selectedSlopeId = null;
let selectedEnvId = null;
let rawSlopeData = null;

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

function bindLayerBoxToggle() {
  const box = document.getElementById('layer-box');
  const btn = document.getElementById('toggle-layer-box');
  if (!box || !btn) return;

  const KEY = 'mine-one-map-layer-box-open';
  const apply = (open) => {
    box.classList.toggle('collapsed', !open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.title = open ? '收起图层控制' : '展开图层控制';
    btn.textContent = open ? '−' : '+';
    try {
      localStorage.setItem(KEY, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  let open = true;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === '0') open = false;
  } catch {
    /* ignore */
  }
  apply(open);

  btn.addEventListener('click', () => apply(box.classList.contains('collapsed')));
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

function bindNavTabs() {
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.scroll;
      if (target) {
        document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });
}

function syncRoleUI() {
  const tag = document.getElementById('user-tag');
  const sel = document.getElementById('role-select');
  if (tag) tag.textContent = roleLabel();
  if (sel) sel.value = getRole();
}

function bindRoleSwitch() {
  const sel = document.getElementById('role-select');
  if (!sel) return;
  sel.addEventListener('change', () => {
    setRole(sel.value);
    syncRoleUI();
    refreshThresholdForm();
    refreshReservesPanel();
    if (window.__lastSlopeData) {
      renderSlopePanel(window.__lastSlopeData, selectedSlopeId, slopeActionHandlers());
    }
  });
}

function refreshEnvironment() {
  if (!mockData?.environment) return;
  mockData.environment = applyEnvThresholds(mockData.environment, getEnvThresholds());
  selectedEnvId = renderEnvironment(mockData.environment, selectedEnvId);
  renderEnvironmentMarkers(mockData.environment);
  refreshAlerts();
  const period = getActivePeriodKey() === 'day' ? '昼间' : '夜间';
  setEnvPollStatus(true, `演示 · 本地 mock · ${period}阈值生效`);
}

function refreshThresholdForm() {
  renderEnvThresholdForm(getEnvThresholds(), {
    onSave: (partial) => {
      saveEnvThresholds(partial);
      refreshEnvironment();
      refreshThresholdForm();
    },
    onReset: () => {
      resetEnvThresholds();
      refreshEnvironment();
      refreshThresholdForm();
    },
  });
}

function refreshReservesPanel(flash) {
  const reserves = getReserves();
  mockData.reserves = reserves;
  renderReserves(reserves, {
    onApply: (payload) => {
      const result = applyDailyMined(payload);
      if (result.ok) {
        mockData.reserves = result.reserves;
        refreshReservesPanel({
          ok: true,
          text: `已写入 ${payload.date}，剩余 ${result.reserves.remaining} ${result.reserves.unit}`,
        });
      }
      return result;
    },
    onReset: () => {
      mockData.reserves = resetReserves();
      refreshReservesPanel({ ok: true, text: '已恢复为 mock 初始值' });
    },
  });
  if (flash?.text) {
    const msg = document.getElementById('reserve-form-msg');
    if (msg) {
      msg.className = flash.ok ? 'poll-ok' : 'poll-err';
      msg.textContent = flash.text;
    }
  }
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
  setSlopePollStatus(
    true,
    DEMO_MOCK_ONLY || !data.live
      ? `边坡本地 mock · 阈值计算 · ${Math.round(cfg.intervalMs / 1000)}s`
      : `边坡实时 · ${Math.round(cfg.intervalMs / 1000)}s 读取`
  );
}

function onSlopeError(err) {
  setSlopePollStatus(false, `边坡刷新失败，保留上次数据 · ${err.message || err}`);
}

async function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  initRole();
  syncRoleUI();
  bindRoleSwitch();
  bindLayerToggles();
  bindLayerBoxToggle();
  bindSlopeListClicks();
  bindEnvListClicks();
  bindNavTabs();
  initResizableSidebars();

  try {
    mockData = await loadMockBundle();
  } catch (err) {
    console.error(err);
    document.getElementById('boot-error').hidden = false;
    document.getElementById('boot-error').textContent =
      '本地测试数据加载失败，请使用传感器网关或静态服务打开 frontend 目录（勿直接双击 file://）。';
    return;
  }

  initEnvThresholds(mockData.envThresholds);
  initReserves(mockData.reserves);

  const center = mockData.slopePoints.mapCenter || [102.445768, 24.786112];
  const zoom = mockData.slopePoints.mapZoom || 15;
  initMap(center, zoom);

  let mapConfig = { defaultBasemap: 'osm-street' };
  try {
    const res = await fetch(`./data/map-config.json?_=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) mapConfig = { ...mapConfig, ...(await res.json()) };
  } catch {
    /* 使用默认配置 */
  }
  try {
    initMapToolbar(mapConfig);
  } catch (err) {
    console.error('[toolbar]', err);
  }

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
