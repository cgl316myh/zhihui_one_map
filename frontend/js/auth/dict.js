/**
 * 系统字典（本地 mock）。大屏文案优先读字典，缺省回退硬编码。
 */

const DICT_KEY = 'mine-one-map-dict-v1';

const SEED = {
  updatedAt: null,
  types: [
    {
      code: 'point_status',
      name: '点位/监测状态',
      items: [
        { code: 'normal', label: '正常', sort: 1, enabled: true },
        { code: 'warn', label: '预警', sort: 2, enabled: true },
        { code: 'alarm', label: '报警', sort: 3, enabled: true },
        { code: 'running', label: '运行', sort: 4, enabled: true },
        { code: 'fault', label: '故障', sort: 5, enabled: true },
        { code: 'offline', label: '离线', sort: 6, enabled: true },
      ],
    },
    {
      code: 'alert_level',
      name: '报警级别',
      items: [
        { code: 'info', label: '提示', sort: 1, enabled: true },
        { code: 'warn', label: '预警', sort: 2, enabled: true },
        { code: 'alarm', label: '报警', sort: 3, enabled: true },
      ],
    },
    {
      code: 'user_role',
      name: '用户角色',
      items: [
        { code: 'admin', label: '管理员', sort: 1, enabled: true },
        { code: 'user', label: '值班员', sort: 2, enabled: true },
      ],
    },
    {
      code: 'layer_type',
      name: '图层类型',
      items: [
        { code: 'environment', label: '环境监测', sort: 1, enabled: true },
        { code: 'slope', label: '边坡 / 雨量', sort: 2, enabled: true },
        { code: 'video', label: '视频监控', sort: 3, enabled: true },
        { code: 'production', label: '生产工段', sort: 4, enabled: true },
      ],
    },
  ],
};

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function load() {
  try {
    const raw = localStorage.getItem(DICT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function save(data) {
  data.updatedAt = new Date().toISOString();
  localStorage.setItem(DICT_KEY, JSON.stringify(data));
}

export function initDictStore() {
  let data = load();
  if (!data || !Array.isArray(data.types) || !data.types.length) {
    data = clone(SEED);
    data.updatedAt = new Date().toISOString();
    save(data);
  }
  return getDictStore();
}

export function getDictStore() {
  return clone(load() || SEED);
}

export function resetDictStore() {
  const data = clone(SEED);
  save(data);
  return getDictStore();
}

export function listDictTypes() {
  return getDictStore().types.map((t) => ({
    code: t.code,
    name: t.name,
    count: (t.items || []).length,
  }));
}

export function getDictType(typeCode) {
  return getDictStore().types.find((t) => t.code === typeCode) || null;
}

export function getDictLabel(typeCode, itemCode, fallback) {
  const type = (load() || SEED).types.find((t) => t.code === typeCode);
  const item = type?.items?.find((i) => i.code === itemCode && i.enabled !== false);
  if (item?.label) return item.label;
  return fallback != null ? fallback : itemCode;
}

export function upsertDictItem(typeCode, item) {
  const data = getDictStore();
  const type = data.types.find((t) => t.code === typeCode);
  if (!type) return { ok: false, message: '字典类型不存在' };
  const code = String(item.code || '').trim();
  if (!code) return { ok: false, message: '字典项 code 必填' };
  const idx = (type.items || []).findIndex((i) => i.code === code);
  const row = {
    code,
    label: String(item.label || code).trim(),
    sort: Number(item.sort) || 0,
    enabled: item.enabled !== false,
    note: String(item.note || ''),
  };
  if (!type.items) type.items = [];
  if (idx >= 0) type.items[idx] = row;
  else type.items.push(row);
  type.items.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  save(data);
  return { ok: true, type: clone(type) };
}

export function deleteDictItem(typeCode, itemCode) {
  const data = getDictStore();
  const type = data.types.find((t) => t.code === typeCode);
  if (!type) return { ok: false, message: '字典类型不存在' };
  type.items = (type.items || []).filter((i) => i.code !== itemCode);
  save(data);
  return { ok: true };
}
