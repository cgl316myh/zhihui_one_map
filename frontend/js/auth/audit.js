/**
 * 轻量操作日志（登录/注册等），供后续管理后台展示。
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
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  list.unshift(row);
  if (list.length > MAX) list = list.slice(0, MAX);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return row;
}
