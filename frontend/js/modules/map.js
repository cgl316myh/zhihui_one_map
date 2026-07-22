import { renderPopupSeries, renderPopupEnvHistory } from './charts.js';

let map = null;
let baseLayerGroup = null;
let currentBasemapId = 'esri-street';
let mapConfig = {};

/** 各底图默认最大切片等级（可被 map-config.json 覆盖） */
const BASEMAP_ZOOM_DEFAULTS = {
  'osm-street': { minZoom: 3, maxZoom: 19, maxNativeZoom: 19, label: 'OSM 城市底图' },
  'amap-img': { minZoom: 3, maxZoom: 18, maxNativeZoom: 18, label: '高德影像底图' },
  'esri-street': { minZoom: 3, maxZoom: 18, maxNativeZoom: 18, label: 'ESRI 城市地图' },
  'esri-img': { minZoom: 3, maxZoom: 17, maxNativeZoom: 17, label: 'ESRI 影像地图' },
};

const layerGroups = {
  environment: null,
  slope: null,
  video: null,
  production: null,
};
const markers = {
  environment: new Map(),
  slope: new Map(),
  video: new Map(),
  production: new Map(),
};

function normalizeBasemapId(id) {
  if (id === 'tdt-vec') return 'osm-street';
  if (id === 'tdt-img' || id === 'osm-hot') return 'amap-img';
  return id;
}

/**
 * 读取某底图的缩放等级配置
 * @returns {{ minZoom: number, maxZoom: number, maxNativeZoom: number, label: string }}
 */
export function getBasemapZoomConfig(id) {
  id = normalizeBasemapId(id);
  const defaults = BASEMAP_ZOOM_DEFAULTS[id] || {
    minZoom: 3,
    maxZoom: 18,
    maxNativeZoom: 18,
    label: id,
  };
  const fromFile = (mapConfig.basemaps && mapConfig.basemaps[id]) || {};
  const minZoom = Number(fromFile.minZoom ?? defaults.minZoom);
  let maxNativeZoom = Number(fromFile.maxNativeZoom ?? defaults.maxNativeZoom);
  let maxZoom = Number(fromFile.maxZoom ?? defaults.maxZoom);
  // 地图允许放大级别不超过切片源最大等级，避免空白瓦片
  if (maxZoom > maxNativeZoom) maxZoom = maxNativeZoom;
  if (minZoom > maxZoom) {
    return { ...defaults, ...fromFile, minZoom: maxZoom, maxZoom, maxNativeZoom };
  }
  return {
    label: fromFile.label || defaults.label,
    minZoom,
    maxZoom,
    maxNativeZoom,
  };
}

export function getAllBasemapZoomConfigs() {
  const ids = Object.keys(BASEMAP_ZOOM_DEFAULTS);
  const out = {};
  ids.forEach((id) => {
    out[id] = getBasemapZoomConfig(id);
  });
  return out;
}

function createBasemapLayers(id) {
  const pane = 'basemapPane';
  id = normalizeBasemapId(id);
  const z = getBasemapZoomConfig(id);
  const common = {
    pane,
    minZoom: z.minZoom,
    maxZoom: z.maxZoom,
    maxNativeZoom: z.maxNativeZoom,
  };

  if (id === 'osm-street') {
    return {
      zoom: z,
      layers: [
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          ...common,
          attribution: '© OpenStreetMap',
        }),
      ],
    };
  }
  if (id === 'amap-img') {
    return {
      zoom: z,
      layers: [
        L.tileLayer(
          'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
          {
            ...common,
            subdomains: ['1', '2', '3', '4'],
            attribution: '高德地图',
          }
        ),
      ],
    };
  }
  if (id === 'esri-street') {
    return {
      zoom: z,
      layers: [
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
          { ...common, attribution: 'Esri' }
        ),
      ],
    };
  }
  if (id === 'esri-img') {
    return {
      zoom: z,
      layers: [
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { ...common, attribution: 'Esri' }
        ),
      ],
    };
  }
  return { error: `未知底图：${id}` };
}

/**
 * 切换底图，并按该数据源限制地图最大/最小缩放等级
 * @returns {{ ok: boolean, message?: string, zoom?: object }}
 */
export function setBasemap(id, cfg) {
  if (cfg) mapConfig = { ...mapConfig, ...cfg };
  if (!map) return { ok: false, message: '地图未初始化' };

  id = normalizeBasemapId(id);
  const built = createBasemapLayers(id);
  if (built.error) return { ok: false, message: built.error };

  if (!baseLayerGroup) {
    baseLayerGroup = L.layerGroup().addTo(map);
  }
  baseLayerGroup.clearLayers();
  built.layers.forEach((ly) => baseLayerGroup.addLayer(ly));
  currentBasemapId = id;

  const z = built.zoom || getBasemapZoomConfig(id);
  const globalMin = Number(mapConfig.mapMinZoom ?? z.minZoom);
  const minZ = Math.max(globalMin, z.minZoom);
  const maxZ = z.maxZoom;
  map.setMinZoom(minZ);
  map.setMaxZoom(maxZ);
  // 当前层级超出新底图能力时自动收回
  const cur = map.getZoom();
  if (cur > maxZ) map.setZoom(maxZ);
  if (cur < minZ) map.setZoom(minZ);

  return { ok: true, zoom: z };
}

export function getBasemapId() {
  return currentBasemapId;
}

function pulseIcon(color, label) {
  return L.divIcon({
    className: 'map-pulse-icon',
    html: `<div class="pulse" style="--c:${color}"><i></i><span>${label || ''}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function statusColor(status) {
  if (status === 'alarm' || status === 'fault' || status === false) return '#ff4d4f';
  if (status === 'warn' || status === 'offline') return '#ffc857';
  return '#2ee6a6';
}

export function initMap(center, zoom) {
  const el = document.getElementById('map');
  if (!el) return null;

  map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
  }).setView([center[1], center[0]], zoom || 15);

  // 底图专用 pane，zIndex 低于 overlay/marker，避免遮挡点位
  if (!map.getPane('basemapPane')) {
    map.createPane('basemapPane');
    map.getPane('basemapPane').style.zIndex = 200;
  }

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  baseLayerGroup = L.layerGroup().addTo(map);
  // 默认 ESRI 城市底图；工具条初始化时再按配置/本地记忆切换
  setBasemap('esri-street');

  Object.keys(layerGroups).forEach((key) => {
    layerGroups[key] = L.layerGroup().addTo(map);
  });

  setTimeout(() => map.invalidateSize(), 80);
  return map;
}

export function getMap() {
  return map;
}

export function invalidateMapSize() {
  if (map) map.invalidateSize();
}

export function setLayerVisible(key, visible) {
  const g = layerGroups[key];
  if (!g || !map) return;
  if (visible) {
    if (!map.hasLayer(g)) g.addTo(map);
  } else if (map.hasLayer(g)) {
    map.removeLayer(g);
  }
}

export function renderEnvironmentMarkers(env) {
  const g = layerGroups.environment;
  if (!g) return;
  g.clearLayers();
  markers.environment.clear();
  (env.points || []).forEach((p) => {
    const m = L.marker([p.lat, p.lng], {
      icon: pulseIcon(statusColor(p.status), '环'),
    }).addTo(g);
    const metrics = Object.entries(p.metrics || {})
      .map(
        ([k, v]) =>
          `<li>${k}: <b>${v}</b>${(p.units && p.units[k]) || ''}</li>`
      )
      .join('');
    const chartId = `popup-env-${p.id}`;
    const hasHist = Array.isArray(p.history) && p.history.length;
    m.bindPopup(
      `
      <div class="popup-card ${hasHist ? 'wide' : ''}">
        <h4>${p.name}</h4>
        <p>${p.location || ''} · ${p.status || ''}</p>
        <ul>${metrics}</ul>
        ${hasHist ? `<div class="popup-chart-label">近 24h</div><div id="${chartId}" class="popup-chart"></div>` : ''}
      </div>`,
      { maxWidth: hasHist ? 320 : 260 }
    );
    if (hasHist) {
      m.on('popupopen', () => {
        setTimeout(() => renderPopupEnvHistory(chartId, p), 30);
      });
    }
    markers.environment.set(p.id, m);
  });
}

export function renderVideoMarkers(video) {
  const g = layerGroups.video;
  if (!g) return;
  g.clearLayers();
  markers.video.clear();
  (video.cameras || []).forEach((c) => {
    const m = L.marker([c.lat, c.lng], {
      icon: pulseIcon(c.online ? '#3dd6ff' : '#ff4d4f', '视'),
    }).addTo(g);
    m.bindPopup(`
      <div class="popup-card">
        <h4>${c.name}</h4>
        <p>${c.online ? '在线' : '离线'} · ${c.scene || ''}</p>
        <div class="popup-video-ph">${c.online ? '实时预览占位' : '信号中断'}</div>
      </div>`);
    markers.video.set(c.id, m);
  });
}

export function renderProductionMarkers(prod, slopePointsMeta) {
  const g = layerGroups.production;
  if (!g) return;
  g.clearLayers();
  markers.production.clear();
  // 优先用 production.mapSpots（已按 slope-points 矿区校准）；否则相对矿区中心偏移
  const center = slopePointsMeta?.mapCenter || [102.445768, 24.786112];
  const spots =
    Array.isArray(prod?.mapSpots) && prod.mapSpots.length
      ? prod.mapSpots
      : [
          {
            id: 'CRUSH',
            name: '破碎工段',
            lat: center[1] - 0.001,
            lng: center[0] + 0.0006,
            status: 'running',
          },
          {
            id: 'SCREEN',
            name: '筛分工段',
            lat: center[1] - 0.0014,
            lng: center[0] + 0.0012,
            status: 'warn',
          },
        ];
  const lineStatus = {};
  (prod.lines || []).forEach((l) => {
    lineStatus[l.id] = l.status;
  });
  spots.forEach((s) => {
    const st = lineStatus[s.id] || s.status;
    const m = L.marker([s.lat, s.lng], {
      icon: pulseIcon(statusColor(st), '产'),
    }).addTo(g);
    m.bindPopup(`<div class="popup-card"><h4>${s.name}</h4><p>状态：${st}</p></div>`);
    markers.production.set(s.id, m);
  });
}

export function renderSlopeMarkers(slopeData, metaPoints) {
  const g = layerGroups.slope;
  if (!g) return;
  g.clearLayers();
  markers.slope.clear();

  const metaMap = new Map((metaPoints || []).map((p) => [p.id, p]));
  const rainMeta = (metaPoints || []).find((p) => p.type === 'rainfall');

  (slopeData.points || []).forEach((p) => {
    const meta = metaMap.get(p.id);
    if (!meta) return;
    const m = L.marker([meta.lat, meta.lng], {
      icon: pulseIcon(statusColor(p.status), '坡'),
    }).addTo(g);

    const chartId = `popup-chart-${p.id}`;
    const th = p.threshold || {};
    const cleared = p.cleared ? ' · 已消警' : '';
    m.bindPopup(
      `<div class="popup-card wide">
        <h4>${p.name}</h4>
        <p>X ${p.x} / Y ${p.y} / H ${p.h} ${p.unit || 'mm'} · 幅值 ${p.magnitude ?? '—'}${cleared}</p>
        <p class="popup-th">阈值 预警 ${th.warn ?? '—'} / 报警 ${th.alarm ?? '—'} · 计算态 ${p.computedStatus || p.status}</p>
        <div class="popup-chart-label">短历史（近 12 点）</div>
        <div id="${chartId}" class="popup-chart"></div>
      </div>`,
      { maxWidth: 320 }
    );
    m.on('popupopen', () => {
      setTimeout(() => renderPopupSeries(chartId, p, { maxPts: 12 }), 30);
    });
    markers.slope.set(p.id, m);
  });

  if (rainMeta && slopeData.rainfall) {
    const r = slopeData.rainfall;
    const m = L.marker([rainMeta.lat, rainMeta.lng], {
      icon: pulseIcon(statusColor(r.status), '雨'),
    }).addTo(g);
    m.bindPopup(`
      <div class="popup-card">
        <h4>${r.name || '雨量监测点'}</h4>
        <p>当前 ${r.valueMm} mm · 累计 ${r.cumulativeMm} mm</p>
      </div>`);
    markers.slope.set(r.id || 'YL-01', m);
  }
}

export function focusSlopePoint(id) {
  const m = markers.slope.get(id);
  if (m && map) {
    map.panTo(m.getLatLng());
    m.openPopup();
  }
}
