/**
 * 轻量操作日志（登录/注册/后台变更等）。
 */

const LOG_KEY = 'mine-one-map-audit-log-v1';
const MAX = 500;

export function appendAuditLog(entry) {
  const row = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    actor: entry.actor || 'anonymous',
    action: entry.action || 'unknown',
    target: entry.target || '',
    result: entry.result || 'ok',
    summary: entry.summary || '',
  };
  let list = listAuditLogs();
  list.unshift(row);
  if (list.length > MAX) list = list.slice(0, MAX);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return row;
}

export function listAuditLogs() {
  try {
    const list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function clearAuditLogs() {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    /* ignore */
  }
}

export function filterAuditLogs({ actor, action, from, to } = {}) {
  return listAuditLogs().filter((row) => {
    if (actor && !String(row.actor).includes(actor)) return false;
    if (action && row.action !== action) return false;
    if (from && row.at < from) return false;
    if (to && row.at > to) return false;
    return true;
  });
}
