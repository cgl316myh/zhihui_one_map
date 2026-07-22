import { loadMockBundle } from './api/mock.js';
import {
  startSlopePolling,
  getSlopeApiConfig,
  stopSlopePolling,
} from './api/slope.js';
import {
  startSensorPolling,
  stopSensorPolling,
  getSensorApiConfig,
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
  renderProduction,
  renderAlerts,
  renderSlopePanel,
  renderReserves,
  renderVideo,
  setSlopePollStatus,
  setEnvPollStatus,
} from './modules/panels.js';
import { initResizableSidebars } from './modules/layout.js';
import { initMapToolbar } from './modules/tools.js';

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

function applySlope(data) {
  if (!data) return;
  window.__lastSlopeData = data;
  selectedSlopeId = renderSlopePanel(data, selectedSlopeId) || selectedSlopeId;
  if (mockData?.slopePoints) {
    renderSlopeMarkers(data, mockData.slopePoints.points || []);
  }
}

function onSensorBundle(bundle) {
  const status = bundle?.status || {};
  const mqttOk = status.mqtt?.connected;
  const env = bundle?.environment;
  const slope = bundle?.slope;

  if (env) applyEnvironment(env);

  // 边坡：网关有 live MQTT 数据时优先用网关；否则由独立 slope 轮询兜底
  if (slope && slope.live) {
    applySlope(slope);
    setSlopePollStatus(
      true,
      `边坡 MQTT 在线 · ${Math.round(getSensorApiConfig().intervalMs / 1000)}s 读取`
    );
  }

  const envLive = Boolean(env?.live);
  const parts = [];
  parts.push(envLive ? '环境实时' : '环境本地兜底');
  if (mqttOk) parts.push('MQTT已连接');
  else if (status.mqtt?.error) parts.push(`MQTT:${status.mqtt.error}`.slice(0, 28));
  else parts.push('MQTT未连');
  const pushN = status.httpPush?.count || 0;
  if (pushN) parts.push(`推送${pushN}次`);
  parts.push(`${Math.round(getSensorApiConfig().intervalMs / 1000)}s轮询`);
  setEnvPollStatus(envLive || mqttOk, parts.join(' · '));
}

function onSensorError(err) {
  setEnvPollStatus(
    false,
    `传感器网关暂不可用，使用本地数据 · ${err.message || err}`
  );
}

function onSlopeData(data) {
  // 若传感器网关已提供 live 边坡，则忽略本地兜底刷新，避免覆盖
  const last = window.__lastSensorBundle;
  if (last?.slope?.live) return;
  applySlope(data);
  const cfg = getSlopeApiConfig();
  const live = Boolean(data.live);
  setSlopePollStatus(
    true,
    live
      ? `边坡实时 · ${Math.round(cfg.intervalMs / 1000)}s 读取`
      : `边坡本地快照 · ${Math.round(cfg.intervalMs / 1000)}s 读取`
  );
}

function onSlopeError(err) {
  const last = window.__lastSensorBundle;
  if (last?.slope?.live) return;
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

  const center = mockData.slopePoints.mapCenter || [102.4785, 24.8512];
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
  renderAlerts(mockData.alerts);
  renderReserves(mockData.reserves);
  renderVideo(mockData.video);
  renderVideoMarkers(mockData.video);
  renderProductionMarkers(mockData.production, mockData.slopePoints);

  ['environment', 'slope', 'video', 'production'].forEach((k) => setLayerVisible(k, true));

  // 传感器网关：30s 读取环境 +（若 live）边坡
  startSensorPolling((bundle) => {
    window.__lastSensorBundle = bundle;
    onSensorBundle(bundle);
  }, onSensorError);

  // 边坡兜底轮询：30s（网关 live 时自动跳过覆盖）
  startSlopePolling(onSlopeData, onSlopeError);

  window.__sensorDebug = {
    stop: () => {
      stopSensorPolling();
      stopSlopePolling();
    },
  };
}

boot();
