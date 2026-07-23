import { initUserStore, authenticate, getDemoAccountsHint } from './auth/users.js';
import {
  setSession,
  redirectIfLoggedIn,
  getRememberedUsername,
  setRememberedUsername,
} from './auth/session.js';
import { createCaptcha } from './auth/captcha.js';
import { appendAuditLog } from './auth/audit.js';
import { isStaticHosting } from './demoMode.js';

const msgEl = document.getElementById('auth-msg');
const form = document.getElementById('login-form');
const btn = document.getElementById('btn-login');
const canvas = document.getElementById('captcha-canvas');

function setMsg(text, ok = false) {
  if (!msgEl) return;
  msgEl.textContent = text || '';
  msgEl.className = 'auth-msg ' + (text ? (ok ? 'ok' : 'err') : '');
}

function homeForRole(role) {
  return role === 'admin' ? './admin.html' : './index.html';
}

async function boot() {
  if (redirectIfLoggedIn('./index.html', './admin.html')) return;
  await initUserStore();

  const captcha = createCaptcha(canvas, 4);
  canvas?.addEventListener('click', () => {
    captcha.refresh();
    setMsg('');
  });

  const remembered = getRememberedUsername();
  if (remembered) {
    const u = document.getElementById('username');
    const r = document.getElementById('remember');
    if (u) u.value = remembered;
    if (r) r.checked = true;
  }

  const params = new URLSearchParams(location.search);
  const prefill = params.get('username');
  if (prefill) {
    const u = document.getElementById('username');
    if (u) u.value = prefill;
  }

  const hint = document.getElementById('demo-hint');
  if (hint) {
    const accounts = getDemoAccountsHint()
      .map((a) => `<code>${a.username}</code> / <code>${a.password}</code>（${a.role}）`)
      .join(' · ');
    const staticLine = isStaticHosting()
      ? '<br />当前为静态演示：全部功能用本地 mock 数据，无需传感器网关。'
      : '';
    hint.innerHTML = `演示账号：${accounts}<br />验证码不区分大小写，点击图片可刷新。${staticLine}`;
  }

  document.getElementById('toggle-pwd')?.addEventListener('click', () => {
    const input = document.getElementById('password');
    const t = document.getElementById('toggle-pwd');
    if (!input || !t) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    t.textContent = show ? '隐藏' : '显示';
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setMsg('');
    const username = document.getElementById('username')?.value?.trim() || '';
    const password = document.getElementById('password')?.value || '';
    const captchaInput = document.getElementById('captcha')?.value || '';
    const remember = Boolean(document.getElementById('remember')?.checked);

    if (!captcha.verify(captchaInput)) {
      setMsg('验证码错误');
      captcha.refresh();
      appendAuditLog({
        actor: username || 'anonymous',
        action: 'login',
        result: 'fail',
        summary: '验证码错误',
      });
      return;
    }

    btn.disabled = true;
    try {
      const result = await authenticate(username, password);
      if (!result.ok) {
        setMsg(result.message || '登录失败');
        captcha.refresh();
        appendAuditLog({
          actor: username || 'anonymous',
          action: 'login',
          result: 'fail',
          summary: result.message || '登录失败',
        });
        return;
      }
      setSession(result.user, { remember });
      setRememberedUsername(username, remember);
      appendAuditLog({
        actor: result.user.username,
        action: 'login',
        result: 'ok',
        summary: `登录成功 · ${result.user.role}`,
      });
      setMsg('登录成功，正在跳转…', true);
      const redirect = params.get('redirect');
      let target = homeForRole(result.user.role);
      if (redirect) {
        try {
          const decoded = decodeURIComponent(redirect);
          if (decoded && !decoded.includes('://') && !decoded.startsWith('//')) {
            target = decoded;
          }
        } catch {
          /* keep default */
        }
      }
      location.href = target;
    } finally {
      btn.disabled = false;
    }
  });
}

boot();
