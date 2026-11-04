import { initUserStore, registerUser, isValidPhone, isValidUsername } from './auth/users.js';
import { redirectIfLoggedIn } from './auth/session.js';
import { appendAuditLog } from './auth/audit.js';

const msgEl = document.getElementById('auth-msg');
const form = document.getElementById('register-form');
const btn = document.getElementById('btn-register');

function setMsg(text, ok = false) {
  if (!msgEl) return;
  msgEl.textContent = text || '';
  msgEl.className = 'auth-msg ' + (text ? (ok ? 'ok' : 'err') : '');
}

async function boot() {
  if (redirectIfLoggedIn('./index.html', './admin.html')) return;
  await initUserStore();

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
    const displayName = document.getElementById('displayName')?.value?.trim() || '';
    const phone = document.getElementById('phone')?.value?.trim() || '';
    const password = document.getElementById('password')?.value || '';
    const password2 = document.getElementById('password2')?.value || '';

    if (!isValidUsername(username)) {
      setMsg('用户名须为 3～20 位字母/数字/下划线');
      return;
    }
    if (!isValidPhone(phone)) {
      setMsg('请填写有效手机号（1 开头 11 位）');
      return;
    }
    if (password.length < 6) {
      setMsg('密码至少 6 位');
      return;
    }
    if (password !== password2) {
      setMsg('两次输入的密码不一致');
      return;
    }

    btn.disabled = true;
    try {
      const result = await registerUser({ username, displayName, phone, password });
      if (!result.ok) {
        setMsg(result.message || '注册失败');
        appendAuditLog({
          actor: username || 'anonymous',
          action: 'register',
          result: 'fail',
          summary: result.message || '注册失败',
        });
        return;
      }
      appendAuditLog({
        actor: result.user.username,
        action: 'register',
        result: 'ok',
        summary: `注册成功 · ${result.user.phone}`,
      });
      setMsg('注册成功，即将前往登录…', true);
      setTimeout(() => {
        location.href = `./login.html?username=${encodeURIComponent(result.user.username)}`;
      }, 600);
    } finally {
      btn.disabled = false;
    }
  });
}

boot();
