import {
  getMap,
  setBasemap,
  getBasemapId,
  getBasemapZoomConfig,
  getAllBasemapZoomConfigs,
} from './map.js';

const TOOLBAR_OPEN_KEY = 'mine-one-map-toolbar-open';
const BASEMAP_KEY = 'mine-one-map-basemap';

/** @type {'idle'|'distance'|'area'} */
let measureMode = 'idle';
let measureLayer = null;
let draftLatLngs = [];
let draftLine = null;
let draftMarkers = [];
let tipMarker = null;
let clickHandler = null;
let dblClickHandler = null;
let moveHandler = null;
let lastMapConfig = {};

function ensureMeasureLayer() {
  const map = getMap();
  if (!map) return null;
  if (!measureLayer) {
    measureLayer = L.layerGroup().addTo(map);
  }
  return measureLayer;
}

function clearDraft() {
  draftLatLngs = [];
  if (draftLine) {
    measureLayer?.removeLayer(draftLine);
    draftLine = null;
  }
  draftMarkers.forEach((m) => measureLayer?.removeLayer(m));
  draftMarkers = [];
  if (tipMarker) {
    measureLayer?.removeLayer(tipMarker);
    tipMarker = null;
  }
}

function stopMeasureHandlers() {
  const map = getMap();
  if (!map) return;
  if (clickHandler) map.off('click', clickHandler);
  if (dblClickHandler) map.off('dblclick', dblClickHandler);
  if (moveHandler) map.off('mousemove', moveHandler);
  clickHandler = dblClickHandler = moveHandler = null;
  map.doubleClickZoom.enable();
  map.getContainer().classList.remove('measure-cursor');
}

function formatDistance(meters) {
  if (meters < 1000) return `${meters.toFixed(1)} m`;
  return `${(meters / 1000).toFixed(3)} km`;
}

function formatArea(sqMeters) {
  if (sqMeters < 1e6) return `${sqMeters.toFixed(1)} m²`;
  return `${(sqMeters / 1e6).toFixed(4)} km²`;
}

function pathLength(latlngs) {
  const map = getMap();
  let sum = 0;
  for (let i = 1; i < latlngs.length; i += 1) {
    sum += map.distance(latlngs[i - 1], latlngs[i]);
  }
  return sum;
}

/** 球面多边形面积（m²），经纬度顺序多边形 */
function geodesicArea(latlngs) {
  if (!latlngs || latlngs.length < 3) return 0;
  const R = 6378137;
  let total = 0;
  const pts = [...latlngs];
  if (
    pts[0].lat !== pts[pts.length - 1].lat ||
    pts[0].lng !== pts[pts.length - 1].lng
  ) {
    pts.push(pts[0]);
  }
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    total +=
      ((p2.lng * Math.PI) / 180 - (p1.lng * Math.PI) / 180) *
      (2 +
        Math.sin((p1.lat * Math.PI) / 180) +
        Math.sin((p2.lat * Math.PI) / 180));
  }
  return Math.abs((total * R * R) / 2);
}

function setTip(text) {
  const el = document.getElementById('measure-tip');
  if (el) el.textContent = text || '';
}

function setToolActive(mode) {
  document.querySelectorAll('[data-measure]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.measure === mode);
  });
}

function addVertexMarker(ll) {
  const m = L.circleMarker(ll, {
    radius: 4,
    color: '#3dd6ff',
    weight: 2,
    fillColor: '#0a1626',
    fillOpacity: 1,
  }).addTo(measureLayer);
  draftMarkers.push(m);
}

function finishDistance() {
  if (draftLatLngs.length < 2) {
    clearDraft();
    setTip('点数不足，已取消');
    return;
  }
  const len = pathLength(draftLatLngs);
  const line = L.polyline(draftLatLngs, {
    color: '#3dd6ff',
    weight: 3,
    dashArray: '6 4',
  }).addTo(measureLayer);
  const mid = draftLatLngs[Math.floor(draftLatLngs.length / 2)];
  L.marker(mid, {
    icon: L.divIcon({
      className: 'measure-label',
      html: `<span>距离 ${formatDistance(len)}</span>`,
    }),
  }).addTo(measureLayer);
  line.bindTooltip(`距离：${formatDistance(len)}`, { sticky: true });
  clearDraft();
  setTip(`测量完成：${formatDistance(len)}（可继续点击加点）`);
}

function finishArea() {
  if (draftLatLngs.length < 3) {
    clearDraft();
    setTip('点数不足，已取消');
    return;
  }
  const ring = [...draftLatLngs, draftLatLngs[0]];
  const area = geodesicArea(draftLatLngs);
  const poly = L.polygon(ring, {
    color: '#ffc857',
    weight: 2,
    fillColor: '#ffc857',
    fillOpacity: 0.2,
  }).addTo(measureLayer);
  const c = poly.getBounds().getCenter();
  L.marker(c, {
    icon: L.divIcon({
      className: 'measure-label',
      html: `<span>面积 ${formatArea(area)}</span>`,
    }),
  }).addTo(measureLayer);
  poly.bindTooltip(`面积：${formatArea(area)}`, { sticky: true });
  clearDraft();
  setTip(`测量完成：${formatArea(area)}（可继续点击加点）`);
}

function startMeasure(mode) {
  const map = getMap();
  if (!map) return;
  stopMeasureHandlers();
  clearDraft();
  ensureMeasureLayer();
  measureMode = mode;
  setToolActive(mode);
  map.doubleClickZoom.disable();
  map.getContainer().classList.add('measure-cursor');

  setTip(
    mode === 'distance'
      ? '距离测量：单击加点，双击结束'
      : '面积测量：单击加点，双击结束'
  );

  clickHandler = (e) => {
    // 避免与双击冲突：跳过紧随双击的第二下由 dblclick 处理结束
    draftLatLngs.push(e.latlng);
    addVertexMarker(e.latlng);
    if (!draftLine) {
      draftLine = L.polyline(draftLatLngs, {
        color: mode === 'distance' ? '#3dd6ff' : '#ffc857',
        weight: 2,
      }).addTo(measureLayer);
    } else {
      draftLine.setLatLngs(
        mode === 'area' && draftLatLngs.length >= 2
          ? [...draftLatLngs, draftLatLngs[0]]
          : draftLatLngs
      );
    }
    if (mode === 'distance' && draftLatLngs.length >= 2) {
      setTip(`当前 ${formatDistance(pathLength(draftLatLngs))} · 双击结束`);
    } else if (mode === 'area' && draftLatLngs.length >= 3) {
      setTip(`当前 ${formatArea(geodesicArea(draftLatLngs))} · 双击结束`);
    }
  };

  dblClickHandler = (e) => {
    L.DomEvent.stop(e);
    // 双击会先触发一次 click，多一个点，去掉末尾重复点更稳妥
    if (draftLatLngs.length >= 2) {
      const a = draftLatLngs[draftLatLngs.length - 1];
      const b = draftLatLngs[draftLatLngs.length - 2];
      if (a.distanceTo(b) < 1e-9 || map.distance(a, b) < 0.5) {
        draftLatLngs.pop();
        const last = draftMarkers.pop();
        if (last) measureLayer.removeLayer(last);
      }
    }
    if (mode === 'distance') finishDistance();
    else finishArea();
  };

  moveHandler = (e) => {
    if (!draftLatLngs.length || !draftLine) return;
    const preview =
      mode === 'area' && draftLatLngs.length >= 2
        ? [...draftLatLngs, e.latlng, draftLatLngs[0]]
        : [...draftLatLngs, e.latlng];
    draftLine.setLatLngs(preview);
  };

  map.on('click', clickHandler);
  map.on('dblclick', dblClickHandler);
  map.on('mousemove', moveHandler);
}

function exitMeasure() {
  stopMeasureHandlers();
  clearDraft();
  measureMode = 'idle';
  setToolActive('');
  setTip('');
}

function clearAllMeasures() {
  exitMeasure();
  if (measureLayer) {
    measureLayer.clearLayers();
  }
  setTip('已清除测量结果');
}

function bindBasemapRadios() {
  const current = getBasemapId();
  document.querySelectorAll('input[name="basemap"]').forEach((input) => {
    input.checked = input.value === current;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const prev = getBasemapId();
      const ok = setBasemap(input.value, lastMapConfig);
      const tip = document.getElementById('basemap-tip');
      if (!ok.ok) {
        // 失败时回退（如天地图未配置 tk）
        document.querySelectorAll('input[name="basemap"]').forEach((r) => {
          r.checked = r.value === prev;
        });
        setBasemap(prev, lastMapConfig);
        if (tip) {
          tip.textContent = ok.message || '底图切换失败';
          tip.hidden = false;
        }
        return;
      }
      try {
        localStorage.setItem(BASEMAP_KEY, input.value);
      } catch {
        /* ignore */
      }
      updateBasemapZoomUI(input.value, ok.zoom);
      if (tip) {
        tip.textContent = '';
        tip.hidden = true;
      }
    });
  });
}

/** 按配置刷新各底图「最大切片等级」标签与当前提示 */
function syncBasemapZoomLabels() {
  const all = getAllBasemapZoomConfigs();
  Object.keys(all).forEach((id) => {
    const z = all[id];
    const badge = document.querySelector(`[data-zoom-for="${id}"]`);
    if (badge) badge.textContent = `Z≤${z.maxZoom}`;
    const label = document.querySelector(
      `.basemap-option[data-basemap="${id}"] .basemap-label`
    );
    if (label && z.label) label.textContent = z.label;
  });
  updateBasemapZoomUI(getBasemapId());
}

function updateBasemapZoomUI(id, zoomCfg) {
  const z = zoomCfg || getBasemapZoomConfig(id || getBasemapId());
  const tip = document.getElementById('basemap-zoom-tip');
  if (tip && z) {
    tip.textContent = `当前底图最大切片等级：Z${z.maxZoom}（原生 Z${z.maxNativeZoom}，最小 Z${z.minZoom}）`;
  }
}

function bindToolbarToggle() {
  const box = document.getElementById('tool-box');
  const btn = document.getElementById('toggle-tool-box');
  if (!box || !btn) return;

  const apply = (open) => {
    box.classList.toggle('collapsed', !open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.title = open ? '收起工具条' : '展开工具条';
    btn.textContent = open ? '−' : '+';
    try {
      localStorage.setItem(TOOLBAR_OPEN_KEY, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  let open = true;
  try {
    if (localStorage.getItem(TOOLBAR_OPEN_KEY) === '0') open = false;
  } catch {
    /* ignore */
  }
  apply(open);
  btn.addEventListener('click', () => apply(box.classList.contains('collapsed')));
}

/**
 * 初始化右上角工具条：测量 + 底图切换
 */
export function initMapToolbar(mapConfig) {
  lastMapConfig = mapConfig || {};
  bindToolbarToggle();

  let preferred = mapConfig?.defaultBasemap || 'osm-street';
  try {
    preferred = localStorage.getItem(BASEMAP_KEY) || preferred;
  } catch {
    /* ignore */
  }
  if (preferred === 'osm-hot') preferred = 'amap-img';
  // 无 tk 时天地图不可用，回退
  const hasTk = Boolean(String(mapConfig?.tiandituTk || '').trim());
  if (!hasTk && (preferred === 'tdt-vec' || preferred === 'tdt-img')) {
    preferred = 'osm-street';
  }

  const result = setBasemap(preferred, mapConfig);
  if (!result.ok) {
    setBasemap('osm-street', mapConfig);
    preferred = 'osm-street';
  }
  syncBasemapZoomLabels();
  bindBasemapRadios();
  // 同步 radio
  document.querySelectorAll('input[name="basemap"]').forEach((input) => {
    input.checked = input.value === getBasemapId();
  });
  const tip = document.getElementById('basemap-tip');
  if (tip) {
    if (!hasTk) {
      tip.hidden = false;
        tip.textContent =
          '天地图需密钥：请管理员在「管理后台 → 地图源与密钥」填写 tiandituTk';
    } else {
      tip.hidden = true;
      tip.textContent = '';
    }
  }

  document.querySelectorAll('[data-measure]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.measure;
      if (mode === 'clear') {
        clearAllMeasures();
        return;
      }
      if (measureMode === mode) {
        exitMeasure();
        setTip('已退出测量');
        return;
      }
      startMeasure(mode);
    });
  });
}
