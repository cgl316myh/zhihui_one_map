/**
 * 演示级角色：Admin 可编辑阈值/储量/消警；User 只读。
 * 非生产认证，将来由 Spring Security 承接。
 */

const STORAGE_KEY = 'mine-one-map-demo-role';

/** @type {'admin'|'user'} */
let _role = 'admin';

export function getRole() {
  return _role;
}

export function isAdmin() {
  return _role === 'admin';
}

export function setRole(role) {
  _role = role === 'user' ? 'user' : 'admin';
  try {
    localStorage.setItem(STORAGE_KEY, _role);
  } catch {
    /* ignore */
  }
  document.body.dataset.role = _role;
  return _role;
}

export function initRole() {
  let saved = 'admin';
  try {
    saved = localStorage.getItem(STORAGE_KEY) || 'admin';
  } catch {
    /* ignore */
  }
  return setRole(saved);
}

export function roleLabel(role = _role) {
  return role === 'user' ? '演示账号 · 值班员' : '演示账号 · 管理员';
}
