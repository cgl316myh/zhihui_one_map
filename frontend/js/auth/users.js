/**
 * 演示用户库（localStorage）。正式环境由 Spring Security + DB 承接。
 */

const USERS_KEY = 'mine-one-map-users-v1';
const SALT = 'mine-one-map:';

const SEED = [
  {
    username: 'admin',
    displayName: '系统管理员',
    phone: '13800000001',
    role: 'admin',
    password: '123456',
    enabled: true,
  },
  {
    username: 'user',
    displayName: '值班员',
    phone: '13800000002',
    role: 'user',
    password: '123456',
    enabled: true,
  },
];

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

export async function hashPassword(password) {
  const data = new TextEncoder().encode(SALT + String(password || ''));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function loadRaw() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

function saveRaw(list) {
  localStorage.setItem(USERS_KEY, JSON.stringify(list));
}

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return clone(rest);
}

export async function initUserStore() {
  let list = loadRaw();
  if (!list || !list.length) {
    list = [];
    const now = new Date().toISOString();
    for (const s of SEED) {
      list.push({
        id: `u-${s.username}`,
        username: s.username,
        displayName: s.displayName,
        phone: s.phone,
        role: s.role,
        enabled: s.enabled !== false,
        passwordHash: await hashPassword(s.password),
        createdAt: now,
        lastLoginAt: null,
      });
    }
    saveRaw(list);
  }
  return listUsers();
}

export function listUsers() {
  return (loadRaw() || []).map(publicUser);
}

export function findUserByUsername(username) {
  const name = String(username || '').trim().toLowerCase();
  const u = (loadRaw() || []).find((x) => String(x.username).toLowerCase() === name);
  return u || null;
}

export function findUserByPhone(phone) {
  const p = String(phone || '').trim();
  const u = (loadRaw() || []).find((x) => x.phone === p);
  return u || null;
}

export function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(String(username || '').trim());
}

export function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone || '').trim());
}

/**
 * @returns {Promise<{ ok: boolean, message?: string, user?: object }>}
 */
export async function registerUser({ username, displayName, phone, password }) {
  await initUserStore();
  const name = String(username || '').trim();
  const phoneStr = String(phone || '').trim();
  const pwd = String(password || '');

  if (!isValidUsername(name)) {
    return { ok: false, message: '用户名须为 3～20 位字母/数字/下划线' };
  }
  if (!isValidPhone(phoneStr)) {
    return { ok: false, message: '请填写有效手机号（1 开头 11 位）' };
  }
  if (pwd.length < 6) {
    return { ok: false, message: '密码至少 6 位' };
  }
  if (findUserByUsername(name)) {
    return { ok: false, message: '用户名已存在' };
  }
  if (findUserByPhone(phoneStr)) {
    return { ok: false, message: '手机号已被注册' };
  }

  const list = loadRaw() || [];
  const user = {
    id: `u-${Date.now()}`,
    username: name,
    displayName: String(displayName || '').trim() || name,
    phone: phoneStr,
    role: 'user',
    enabled: true,
    passwordHash: await hashPassword(pwd),
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
  list.push(user);
  saveRaw(list);
  return { ok: true, user: publicUser(user) };
}

/**
 * @returns {Promise<{ ok: boolean, code?: string, message?: string, user?: object }>}
 */
export async function authenticate(username, password) {
  await initUserStore();
  const u = findUserByUsername(username);
  if (!u) return { ok: false, code: 'not_found', message: '账号不存在' };
  if (u.enabled === false) return { ok: false, code: 'disabled', message: '账号已禁用' };
  const hash = await hashPassword(password);
  if (hash !== u.passwordHash) {
    return { ok: false, code: 'bad_password', message: '密码错误' };
  }
  const list = loadRaw() || [];
  const idx = list.findIndex((x) => x.id === u.id);
  if (idx >= 0) {
    list[idx].lastLoginAt = new Date().toISOString();
    saveRaw(list);
  }
  return { ok: true, user: publicUser({ ...u, lastLoginAt: new Date().toISOString() }) };
}

export function getDemoAccountsHint() {
  return [
    { username: 'admin', password: '123456', role: '管理员' },
    { username: 'user', password: '123456', role: '值班员' },
  ];
}
