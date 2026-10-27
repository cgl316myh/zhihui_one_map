/**
 * CAD 矢量图层：按 /api/cad-layers 清单懒加载 GeoJSON（静态 /data/cad/*）。
 * 矿界线加载后视野对齐其范围并外扩 30m；矿界点绿色 + 永久横排标签。
 */
import { apiGet } from '../api/client.js';
import { getMap } from './map.js';

const LS_KEY = 'mine-one-map-cad-layers-v1';
const FIT_LAYER_ID = 'kuangjie_line';
const POINT_LAYER_ID = 'kuangjie_point';
const BOUNDS_PAD_METERS = 30;

/** @type {Array<object>} */
let catalog = [];
/** @type {Record<string, L.LayerGroup>} */
const groups = {};
/** @type {Record<string, boolean>} */
const loaded = {};
/** @type {Record<string, boolean>} */
const visible = {};
let didFitKuangjie = false;

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePrefs() {
  const prefs = {};
  catalog.forEach((layer) => {
    if (visible[layer.id] != null) prefs[layer.id] = visible[layer.id];
  });
  localStorage.setItem(LS_KEY, JSON.stringify(prefs));
}

/** 按米外扩经纬度范围（近似） */
function expandBoundsByMeters(bounds, meters) {
  if (!bounds || !bounds.isValid()) return bounds;
  const lat = bounds.getCenter().lat;
  const rad = (lat * Math.PI) / 180;
  const dLat = meters / 111320;
  const cos = Math.cos(rad);
  const dLng = meters / (111320 * Math.max(cos, 0.2));
  return L.latLngBounds(
    [bounds.getSouth() - dLat, bounds.getWest() - dLng],
    [bounds.getNorth() + dLat, bounds.getEast() + dLng]
  );
}

function fitToKuangjieLine(gjLayer) {
  if (didFitKuangjie) return;
  const map = getMap();
  if (!map || !gjLayer) return;
  const raw = gjLayer.getBounds?.();
  if (!raw || !raw.isValid()) return;
  const padded = expandBoundsByMeters(raw, BOUNDS_PAD_METERS);
  map.fitBounds(padded, { animate: false, maxZoom: 18 });
  didFitKuangjie = true;
}

function styleFor(layerMeta, feature) {
  const s = layerMeta.style || {};
  const isPointLayer =
    layerMeta.id === POINT_LAYER_ID ||
    String(layerMeta.geom || '').toLowerCase().includes('point') ||
    feature?.geometry?.type === 'Point';

  if (isPointLayer) {
    // 矿界点固定绿色（可被配置覆盖为其它非默认红）
    const green = '#22c55e';
    const greenDark = '#16a34a';
    const cfgColor = s.fillColor || s.color;
    const useGreen =
      layerMeta.id === POINT_LAYER_ID ||
      !cfgColor ||
      cfgColor === '#e74c3c' ||
      cfgColor === '#c0392b';
    return {
      radius: Number(s.radius) || 7,
      color: useGreen ? greenDark : s.color || greenDark,
      fillColor: useGreen ? green : s.fillColor || s.color || green,
      weight: Number(s.weight) || 2,
      opacity: Number(s.opacity) ?? 1,
      fillOpacity: Number(s.fillOpacity) ?? 0.9,
    };
  }
  return {
    color: s.color || '#e74c3c',
    weight: Number(s.weight) || 2,
    opacity: Number(s.opacity) ?? 0.95,
    fillColor: s.fillColor || s.color || '#e74c3c',
    fillOpacity: Number(s.fillOpacity) ?? 0.12,
  };
}

/** 矿界点标签：优先 Text（矿1、公司名等），否则 Name */
function pointLabelText(props) {
  const text = String(props?.Text ?? '').trim();
  if (text) return text;
  const name = String(props?.Name ?? '').trim();
  if (!name || name === 'null' || name === 'undefined') return '';
  return name;
}

function popupHtml(layerMeta, props) {
  const fields = Array.isArray(layerMeta.popupFields) && layerMeta.popupFields.length
    ? layerMeta.popupFields
    : ['Text', 'Name', 'Layer'];
  const rows = fields
    .map((f) => {
      const v = props?.[f];
      if (v == null || v === '') return '';
      return `<div><b>${f}</b>：${String(v)}</div>`;
    })
    .filter(Boolean);
  const title = layerMeta.name || props?.Layer || 'CAD';
  return `<div class="cad-popup"><strong>${title}</strong>${rows.join('') || '<div class="muted">无属性</div>'}</div>`;
}

async function fetchGeoJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`加载失败 ${url} (${res.status})`);
  return res.json();
}

async function ensureLoaded(layerMeta) {
  const id = layerMeta.id;
  if (loaded[id]) return;
  const map = getMap();
  if (!map) return;

  const group = L.layerGroup();
  groups[id] = group;

  const paneName = `cadPane_${id}`;
  if (!map.getPane(paneName)) {
    map.createPane(paneName);
    map.getPane(paneName).style.zIndex = String(layerMeta.zIndex || 450);
  }

  const data = await fetchGeoJson(layerMeta.url);
  const showLabels = id === POINT_LAYER_ID || layerMeta.showLabels === true;

  const gj = L.geoJSON(data, {
    pane: paneName,
    style: (feat) => styleFor(layerMeta, feat),
    pointToLayer: (feat, latlng) =>
      L.circleMarker(latlng, { ...styleFor(layerMeta, feat), pane: paneName }),
    onEachFeature: (feat, lyr) => {
      const props = feat.properties || {};
      lyr.bindPopup(popupHtml(layerMeta, props));
      if (showLabels) {
        const label = pointLabelText(props);
        if (label) {
          lyr.bindTooltip(label, {
            permanent: true,
            direction: 'top',
            offset: [0, -8],
            className: 'cad-point-label',
            opacity: 1,
          });
        }
      }
    },
  });
  gj.addTo(group);

  if (id === FIT_LAYER_ID) {
    fitToKuangjieLine(gj);
  }

  loaded[id] = true;
}

export async function setCadLayerVisible(id, on) {
  const layerMeta = catalog.find((l) => l.id === id);
  if (!layerMeta) return;
  const map = getMap();
  if (!map) return;

  visible[id] = Boolean(on);
  savePrefs();

  if (!on) {
    const g = groups[id];
    if (g && map.hasLayer(g)) map.removeLayer(g);
    return;
  }

  try {
    await ensureLoaded(layerMeta);
    const g = groups[id];
    if (g && !map.hasLayer(g)) g.addTo(map);
    // 若线层后开，补一次视野
    if (id === FIT_LAYER_ID && !didFitKuangjie) {
      const lineGroup = groups[id];
      lineGroup?.eachLayer((lyr) => {
        if (lyr.getBounds) fitToKuangjieLine(lyr);
      });
    }
  } catch (err) {
    console.warn('[cad]', id, err);
    visible[id] = false;
    savePrefs();
    const input = document.querySelector(`[data-cad-layer="${id}"]`);
    if (input) input.checked = false;
    throw err;
  }
}

function mountToolbar(layers) {
  const body = document.getElementById('tool-box-body');
  if (!body) return;
  let section = document.getElementById('cad-layer-section');
  if (!section) {
    section = document.createElement('div');
    section.className = 'tool-section';
    section.id = 'cad-layer-section';
    const first = body.querySelector('.tool-section');
    if (first && first.nextSibling) {
      body.insertBefore(section, first.nextSibling);
    } else {
      body.appendChild(section);
    }
  }
  if (!layers.length) {
    section.hidden = true;
    section.innerHTML = '';
    return;
  }
  section.hidden = false;
  section.innerHTML = `
    <div class="tool-section-title">采场 CAD</div>
    ${layers
      .map(
        (l) => `
      <label>
        <input type="checkbox" data-cad-layer="${l.id}" ${visible[l.id] ? 'checked' : ''} />
        ${l.name || l.id}
      </label>`
      )
      .join('')}`;

  section.querySelectorAll('[data-cad-layer]').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await setCadLayerVisible(input.dataset.cadLayer, input.checked);
      } catch (e) {
        alert(`CAD 图层加载失败：${e.message || e}`);
      }
    });
  });
}

/**
 * 拉取清单并按 defaultOn / 本地偏好加载。
 * 优先加载矿界线以便先定视野。
 */
export async function initCadLayers() {
  const r = await apiGet('/api/cad-layers');
  if (!r.ok) {
    console.warn('[cad] catalog failed', r.message);
    catalog = [];
    mountToolbar([]);
    return [];
  }
  catalog = Array.isArray(r.data?.layers) ? r.data.layers : [];
  const prefs = loadPrefs();

  catalog.forEach((layer) => {
    if (prefs[layer.id] != null) {
      visible[layer.id] = Boolean(prefs[layer.id]);
    } else {
      visible[layer.id] = Boolean(layer.defaultOn);
    }
  });

  mountToolbar(catalog);

  const ordered = [...catalog].sort((a, b) => {
    if (a.id === FIT_LAYER_ID) return -1;
    if (b.id === FIT_LAYER_ID) return 1;
    return (a.order || 0) - (b.order || 0);
  });

  for (const layer of ordered) {
    if (visible[layer.id]) {
      try {
        await setCadLayerVisible(layer.id, true);
      } catch (e) {
        console.warn('[cad] auto load failed', layer.id, e);
      }
    }
  }
  return catalog;
}

export function getCadCatalog() {
  return catalog.slice();
}
