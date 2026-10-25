/**
 * 统一 REST 客户端：Bearer JWT + {code,message,data}
 */

import { getAccessToken, getRefreshToken, updateTokens, clearSession } from '../auth/session.js';

const API_BASE = '';

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { code: res.status, message: text, data: null };
  }
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const body = await parseBody(res);
  if (!res.ok || !body || body.code !== 0 || !body.data?.accessToken) {
    return false;
  }
  updateTokens(body.data.accessToken, body.data.refreshToken || refreshToken);
  return true;
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: any, auth?: boolean, retry?: boolean }} opts
 */
export async function apiRequest(path, opts = {}) {
  const method = opts.method || 'GET';
  const auth = opts.auth !== false;
  const headers = {
    Accept: 'application/json',
    ...(opts.body != null ? { 'Content-Type': 'application/json' } : {}),
  };
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });

  if (res.status === 401 && auth && opts.retry !== false) {
    const ok = await refreshAccessToken();
    if (ok) {
      return apiRequest(path, { ...opts, retry: false });
    }
    clearSession();
  }

  const body = await parseBody(res);
  if (!body) {
    return { ok: false, code: res.status, message: `HTTP ${res.status}`, data: null };
  }
  if (body.code !== 0) {
    if (body.code === 401 || res.status === 401) {
      // keep message
    }
    return {
      ok: false,
      code: body.code,
      message: body.message || '请求失败',
      data: body.data,
    };
  }
  return { ok: true, code: 0, message: body.message || 'ok', data: body.data };
}

export function apiGet(path, opts) {
  return apiRequest(path, { ...opts, method: 'GET' });
}

export function apiPost(path, body, opts) {
  return apiRequest(path, { ...opts, method: 'POST', body });
}

export function apiPut(path, body, opts) {
  return apiRequest(path, { ...opts, method: 'PUT', body });
}

export function apiDelete(path, opts) {
  return apiRequest(path, { ...opts, method: 'DELETE' });
}
