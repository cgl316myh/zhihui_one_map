/**
 * 角色：与登录会话同步。Admin 可编辑阈值/储量/消警；User 只读。
 */

/** @type {'admin'|'user'} */
let _role = 'user';

export function getRole() {
  return _role;
}

export function isAdmin() {
  return _role === 'admin';
}

export function setRole(role) {
  _role = role === 'admin' ? 'admin' : 'user';
  document.body.dataset.role = _role;
  return _role;
}

/** 由登录会话初始化角色（不再使用顶栏下拉切换） */
export function initRoleFromSession(session) {
  if (!session) {
    setRole('user');
    return getRole();
  }
  return setRole(session.role);
}

export function roleLabel(sessionOrRole) {
  if (sessionOrRole && typeof sessionOrRole === 'object') {
    const name = sessionOrRole.displayName || sessionOrRole.username || '';
    const role = sessionOrRole.role === 'admin' ? '管理员' : '值班员';
    return `${name} · ${role}`;
  }
  return sessionOrRole === 'admin' || _role === 'admin' ? '管理员' : '值班员';
}

/** @deprecated 保留空实现，避免旧调用报错 */
export function initRole() {
  return getRole();
}
