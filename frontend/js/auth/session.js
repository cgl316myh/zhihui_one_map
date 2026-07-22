/**
 * 本地会话（演示）。正式环境由服务端 Session / JWT 承接。
 */

const SESSION_KEY = 'mine-one-map-session-v1';
const REMEMBER_KEY = 'mine-one-map-remember-user';

export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.username || !s?.role) return null;
    return s;
  } catch {
    return null;
  }
}

export function isLoggedIn() {
  return Boolean(getSession());
}

/**
 * @param {object} user
 * @param {{ remember?: boolean }} opts
 */
export function setSession(user, opts = {}) {
  const session = {
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role === 'admin' ? 'admin' : 'user',
    phone: user.phone || '',
    loginAt: new Date().toISOString(),
  };
  const json = JSON.stringify(session);
  sessionStorage.setItem(SESSION_KEY, json);
  if (opts.remember) {
    localStorage.setItem(SESSION_KEY, json);
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
  return session;
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function getRememberedUsername() {
  try {
    return localStorage.getItem(REMEMBER_KEY) || '';
  } catch {
    return '';
  }
}

export function setRememberedUsername(username, on) {
  try {
    if (on && username) localStorage.setItem(REMEMBER_KEY, username);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* ignore */
  }
}

/** 未登录则跳转登录页；已登录返回 session */
export function requireSession(loginUrl = './login.html') {
  const s = getSession();
  if (!s) {
    const next = encodeURIComponent(location.pathname + location.search + location.hash);
    const sep = loginUrl.includes('?') ? '&' : '?';
    location.replace(`${loginUrl}${sep}redirect=${next}`);
    return null;
  }
  return s;
}

/** 已登录访问登录/注册页时跳转首页 */
export function redirectIfLoggedIn(homeUrl = './index.html', adminUrl = './index.html') {
  const s = getSession();
  if (!s) return false;
  location.replace(s.role === 'admin' ? adminUrl : homeUrl);
  return true;
}

export function logout(loginUrl = './login.html') {
  clearSession();
  location.href = loginUrl;
}
