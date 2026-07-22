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
  renderProduction,
  renderAlerts,
  renderSlopePanel,
  renderReserves,
  renderVideo,
  setSlopePollStatus,
  setEnvPollStatus,
} from './modules/panels.js';
import { buildAlertsFromMock } from './modules/alerts.js';
import { initResizableSidebars } from './modules/layout.js';
import { initMapToolbar } from './modules/tools.js';

/** 演示原型：环境/边坡/报警均以本地 mock 为准，不接真实 MQTT/HTTP */
const DEMO_MOCK_ONLY = true;

let mockData = null;
let selectedSlopeId = null;

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
    if (last) renderSlopePanel(last, selectedSlopeId);
    focusSlopePoint(selectedSlopeId);
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

function applyEnvironment(env) {
  if (!env) return;
  renderEnvironment(env);
  renderEnvironmentMarkers(env);
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

function applySlope(data) {
  if (!data) return;
  window.__lastSlopeData = data;
  selectedSlopeId = renderSlopePanel(data, selectedSlopeId) || selectedSlopeId;
  if (mockData?.slopePoints) {
    renderSlopeMarkers(data, mockData.slopePoints.points || []);
  }
  refreshAlerts(data);
}

function onSlopeData(data) {
  applySlope(data);
  const cfg = getSlopeApiConfig();
  setSlopePollStatus(
    true,
    DEMO_MOCK_ONLY || !data.live
      ? `边坡本地 mock · ${Math.round(cfg.intervalMs / 1000)}s 读取`
      : `边坡实时 · ${Math.round(cfg.intervalMs / 1000)}s 读取`
  );
}

function onSlopeError(err) {
  setSlopePollStatus(false, `边坡刷新失败，保留上次数据 · ${err.message || err}`);
}

async function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  bindLayerToggles();
  bindLayerBoxToggle();
  bindSlopeListClicks();
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

  // 首屏本地数据
  applyEnvironment(mockData.environment);
  renderProduction(mockData.production);
  refreshAlerts(null);
  renderReserves(mockData.reserves);
  renderVideo(mockData.video);
  renderVideoMarkers(mockData.video);
  renderProductionMarkers(mockData.production, mockData.slopePoints);

  setEnvPollStatus(true, '演示原型 · 环境/报警本地 mock（不接实时推送）');

  ['environment', 'slope', 'video', 'production'].forEach((k) => setLayerVisible(k, true));

  // 边坡：preferMock 时读 ./data/slope.json，保留轮询形态
  startSlopePolling(onSlopeData, onSlopeError);

  window.__sensorDebug = {
    stop: () => {
      stopSlopePolling();
    },
  };
}

boot();
