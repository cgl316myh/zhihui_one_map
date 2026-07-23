/**
 * 地图源与密钥：文件默认 + localStorage 覆盖，供大屏与后台共用。
 */

const MAP_KEY = 'mine-one-map-map-config-v1';

const HARDCODED_URLS = {
  'osm-street': {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution: '© OpenStreetMap',
  },
  'amap-img': {
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: '1234',
    attribution: '高德',
  },
  'esri-street': {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri',
  },
  'esri-img': {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri',
  },
  'tdt-vec': { kind: 'tianditu', layer: 'vec', anno: 'cva' },
  'tdt-img': { kind: 'tianditu', layer: 'img', anno: 'cia' },
};

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function loadOverride() {
  try {
    const raw = localStorage.getItem(MAP_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveMapConfigOverride(cfg) {
  const data = clone(cfg);
  data.updatedAt = new Date().toISOString();
  localStorage.setItem(MAP_KEY, JSON.stringify(data));
  return data;
}

export function clearMapConfigOverride() {
  localStorage.removeItem(MAP_KEY);
}

export function getMapConfigOverride() {
  return loadOverride();
}

/**
 * 合并文件配置与本地覆盖
 */
export function mergeMapConfig(fileCfg = {}) {
  const base = clone(fileCfg);
  const ov = loadOverride();
  if (!ov) {
    // 补全 url 元数据供后台展示
    return enrichForAdmin(base);
  }
  const merged = {
    ...base,
    ...ov,
    basemaps: { ...(base.basemaps || {}), ...(ov.basemaps || {}) },
  };
  return enrichForAdmin(merged);
}

function enrichForAdmin(cfg) {
  const out = clone(cfg);
  if (!out.basemaps) out.basemaps = {};
  Object.keys(HARDCODED_URLS).forEach((id) => {
    const meta = HARDCODED_URLS[id];
    const cur = out.basemaps[id] || {};
    out.basemaps[id] = {
      id,
      label: cur.label || id,
      minZoom: cur.minZoom ?? 3,
      maxZoom: cur.maxZoom ?? 18,
      maxNativeZoom: cur.maxNativeZoom ?? cur.maxZoom ?? 18,
      enabled: cur.enabled !== false,
      urlTemplate: cur.urlTemplate || meta.url || '',
      subdomains: cur.subdomains || meta.subdomains || '',
      kind: meta.kind || 'xyz',
      layer: meta.layer,
      anno: meta.anno,
      attribution: cur.attribution || meta.attribution || '',
    };
  });
  // 保留未知自定义源
  Object.keys(out.basemaps).forEach((id) => {
    if (!out.basemaps[id].id) out.basemaps[id].id = id;
    if (out.basemaps[id].enabled == null) out.basemaps[id].enabled = true;
  });
  return out;
}

/** 写回时只存可编辑字段，避免膨胀 */
export function toPersistedMapConfig(adminCfg) {
  const basemaps = {};
  Object.entries(adminCfg.basemaps || {}).forEach(([id, b]) => {
    basemaps[id] = {
      label: b.label,
      minZoom: Number(b.minZoom) || 3,
      maxZoom: Number(b.maxZoom) || 18,
      maxNativeZoom: Number(b.maxNativeZoom) || Number(b.maxZoom) || 18,
      enabled: b.enabled !== false,
      urlTemplate: b.urlTemplate || '',
      subdomains: b.subdomains || '',
    };
  });
  return {
    defaultBasemap: adminCfg.defaultBasemap || 'esri-img',
    mapMinZoom: Number(adminCfg.mapMinZoom) || 3,
    tiandituTk: String(adminCfg.tiandituTk || ''),
    basemaps,
  };
}
