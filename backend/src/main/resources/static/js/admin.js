import {
  initUserStore,
  listUsers,
  listUsersAsync,
  adminCreateUser,
  adminUpdateUser,
  adminResetPassword,
  adminDeleteUser,
  resetUsersToSeed,
} from './auth/users.js';
import { getSession, requireSession, logout } from './auth/session.js';
import { appendAuditLog, listAuditLogs, clearAuditLogs, filterAuditLogs } from './auth/audit.js';
import {
  initDictStore,
  listDictTypes,
  getDictType,
  upsertDictItem,
  deleteDictItem,
  resetDictStore,
  getDictLabel,
} from './auth/dict.js';
import {
  mergeMapConfig,
  saveMapConfigOverride,
  clearMapConfigOverride,
  toPersistedMapConfig,
} from './auth/mapConfigStore.js';
import {
  mergeSensorConfig,
  saveSensorConfigOverride,
  clearSensorConfigOverride,
  downloadSensorConfigJson,
  syncSensorConfigToGateway,
} from './auth/sensorConfigStore.js';
import { isStaticHosting } from './demoMode.js';
import { apiGet, apiPost, apiPut } from './api/client.js';
import {
  initEnvThresholds,
  getEnvThresholds,
  getDefaultEnvThresholds,
  saveEnvThresholds,
  resetEnvThresholds,
  getActivePeriodKey,
} from './modules/envThresholds.js';
import {
  initReserves,
  getReserves,
  getReservesInput,
  saveReservesConfig,
  draftReservesConfig,
  resetReserves,
  reloadReservesFromServer,
  clearReservesLocalCache,
  computeReservesDerived,
} from './modules/reserves.js';

let session = null;
let fileMapConfig = {};
let fileSensorConfig = {};
let fileThresholds = null;
let fileReserves = null;
let selectedDictType = 'point_status';
let sensorDraft = null;
/** 数据接入页消息流（跨重渲染保留） */
let sensorMsgLog = [];

const DEFAULT_TEST_PUSH_JSON = `{
  "clientId": "Pczd8HKi3MdgGTW6SAeB",
  "ambientTemperature": 26.5,
  "ambientHumidity": 55,
  "noise": 48,
  "PM2.5": 20,
  "PM10": 35,
  "pressure": 1012,
  "detectedTime": "REPLACE_TIME",
  "longitude": 102.44505,
  "latitude": 24.78545
}`;

function pushSensorMsg(level, text, detail) {
  sensorMsgLog.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    level: level || 'info',
    text: text || '',
    detail: detail || '',
  });
  if (sensorMsgLog.length > 80) sensorMsgLog.length = 80;
  paintSensorMsgLog();
}

function paintSensorMsgLog() {
  const el = $('sensor-msg-log');
  if (!el) return;
  if (!sensorMsgLog.length) {
    el.innerHTML = '<div class="sensor-msg empty">暂无消息。可点「发送测试推送」或「刷新接入状态」。</div>';
    return;
  }
  el.innerHTML = sensorMsgLog
    .map((m) => {
      const detail = m.detail
        ? `<pre class="sensor-msg-detail">${escapeHtml(m.detail)}</pre>`
        : '';
      return `<div class="sensor-msg ${m.level}" data-id="${m.id}">
        <div class="sensor-msg-hd">
          <span class="sensor-msg-lv">${m.level}</span>
          <time>${fmtTime(m.at)}</time>
        </div>
        <div class="sensor-msg-text">${escapeHtml(m.text)}</div>
        ${detail}
      </div>`;
    })
    .join('');
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatStatusBrief(st) {
  if (!st) return '';
  const mqtt = st.mqtt || {};
  const http = st.httpPush || {};
  const c = st.counts || {};
  return [
    `接收开关=${st.ingest?.enabled !== false}`,
    `MQTT=${mqtt.connected ? '已连接' : '未连接'}${mqtt.error ? ` (${mqtt.error})` : ''}`,
    `HTTP次数=${http.count ?? 0}`,
    `meteo=${c.meteo ?? 0} gnss=${c.gnss ?? 0} rain=${c.rainfall ?? 0}`,
  ].join(' · ');
}

function formatEnvBrief(env) {
  if (!env) return '';
  const pts = env.points || [];
  const live = pts.filter((p) => p.metrics && Object.keys(p.metrics).length);
  const lines = live.slice(0, 3).map((p) => {
    const m = p.metrics || {};
    return `${p.name}: T=${m.temperature ?? '—'} H=${m.humidity ?? '—'} 噪声=${m.noise ?? '—'}`;
  });
  return `live=${Boolean(env.live)} · 有数据点 ${live.length}/${pts.length}` +
    (lines.length ? `\n${lines.join('\n')}` : '');
}

function $(id) {
  return document.getElementById(id);
}

function flash(text, ok = true) {
  const el = $('flash');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
  el.className = 'flash ' + (ok ? 'ok' : 'err');
  if (text) setTimeout(() => { el.hidden = true; }, 3500);
}

function fmtTime(iso) {
  if (!iso) return '—';
  return String(iso).replace('T', ' ').slice(0, 19);
}

function requireAdmin() {
  session = requireSession('./login.html');
  if (!session) return false;
  if (session.role !== 'admin') {
    flash('无管理员权限，返回一张图', false);
    location.replace('./index.html');
    return false;
  }
  return true;
}

function showPanel(name) {
  document.querySelectorAll('.panel-view').forEach((el) => {
    el.hidden = el.id !== `panel-${name}`;
  });
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.panel === name);
  });
  const renderers = {
    overview: renderOverview,
    users: renderUsers,
    thresholds: renderThresholds,
    reserves: renderReservesAdmin,
    dict: renderDict,
    maps: renderMaps,
    'sensor-connect': renderSensorConnect,
    'sensor-mapping': renderSensorMapping,
    'sensor-test': renderSensorTest,
    audit: renderAudit,
    perms: renderPerms,
  };
  renderers[name]?.();
}

function bindNav() {
  $('admin-nav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-panel]');
    if (!btn) return;
    showPanel(btn.dataset.panel);
  });
  $('btn-logout')?.addEventListener('click', () => {
    appendAuditLog({ actor: session.username, action: 'logout', result: 'ok', summary: '后台退出' });
    logout('./login.html');
  });
}

let _usersCache = [];

async function refreshUsersCache() {
  _usersCache = await listUsersAsync();
  return _usersCache;
}

function cachedUsers() {
  if (isStaticHosting()) return listUsers();
  return _usersCache;
}

/* —— 概览 —— */
async function renderOverview() {
  const users = await refreshUsersCache();
  const logs = listAuditLogs().slice(0, 8);
  const admins = users.filter((u) => u.role === 'admin').length;
  const normals = users.filter((u) => u.role !== 'admin').length;
  const box = $('panel-overview');
  box.innerHTML = `
    <h2>概览</h2>
    <div class="kpi-row">
      <div class="kpi"><span>用户总数</span><b>${users.length}</b></div>
      <div class="kpi"><span>管理员</span><b>${admins}</b></div>
      <div class="kpi"><span>普通用户</span><b>${normals}</b></div>
      <div class="kpi"><span>操作日志</span><b>${listAuditLogs().length}</b></div>
    </div>
    <div class="card-block">
      <h3 style="margin-top:0">最近操作</h3>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>结果</th><th>摘要</th></tr></thead>
          <tbody>
            ${
              logs.length
                ? logs
                    .map(
                      (r) => `<tr>
                      <td>${fmtTime(r.at)}</td><td>${r.actor}</td><td>${r.action}</td>
                      <td>${r.result}</td><td>${r.summary || ''}</td></tr>`
                    )
                    .join('')
                : '<tr><td colspan="5">暂无日志</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>`;
}

/* —— 用户 —— */
async function renderUsers() {
  const box = $('panel-users');
  await refreshUsersCache();
  box.innerHTML = `
    <h2>用户管理</h2>
    <div class="toolbar" id="user-filters">
      <label>关键字<input type="text" id="uf-q" placeholder="用户名/手机号" /></label>
      <label>角色
        <select id="uf-role"><option value="">全部</option><option value="admin">管理员</option><option value="user">值班员</option></select>
      </label>
      <label>状态
        <select id="uf-enabled"><option value="">全部</option><option value="1">启用</option><option value="0">禁用</option></select>
      </label>
      <button type="button" class="btn" id="btn-user-filter">筛选</button>
      <button type="button" class="btn" id="btn-user-create">新建用户</button>
      <button type="button" class="btn ghost" id="btn-user-reset-seed">恢复预置用户</button>
    </div>
    <div class="table-wrap" id="user-table"></div>`;

  const draw = () => {
    const q = ($('uf-q')?.value || '').trim().toLowerCase();
    const role = $('uf-role')?.value || '';
    const en = $('uf-enabled')?.value;
    let rows = cachedUsers();
    if (q) {
      rows = rows.filter(
        (u) =>
          u.username.toLowerCase().includes(q) ||
          String(u.phone || '').includes(q) ||
          String(u.displayName || '').toLowerCase().includes(q)
      );
    }
    if (role) rows = rows.filter((u) => u.role === role);
    if (en === '1') rows = rows.filter((u) => u.enabled !== false);
    if (en === '0') rows = rows.filter((u) => u.enabled === false);

    $('user-table').innerHTML = `
      <table class="data">
        <thead>
          <tr>
            <th>用户名</th><th>显示名</th><th>手机号</th><th>角色</th><th>状态</th>
            <th>创建</th><th>最近登录</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (u) => `<tr data-id="${u.id}">
              <td>${u.username}</td>
              <td>${u.displayName || ''}</td>
              <td>${u.phone || ''}</td>
              <td>${getDictLabel('user_role', u.role, u.role === 'admin' ? '管理员' : '值班员')}</td>
              <td>${u.enabled === false ? '禁用' : '启用'}</td>
              <td>${fmtTime(u.createdAt)}</td>
              <td>${fmtTime(u.lastLoginAt)}</td>
              <td class="ops">
                <button type="button" class="btn ghost" data-act="edit">编辑</button>
                <button type="button" class="btn ghost" data-act="pwd">重置密码</button>
                <button type="button" class="btn danger" data-act="del">删除</button>
              </td>
            </tr>`
            )
            .join('') || '<tr><td colspan="8">无匹配用户</td></tr>'}
        </tbody>
      </table>`;
  };

  draw();
  $('btn-user-filter')?.addEventListener('click', draw);
  $('btn-user-create')?.addEventListener('click', () => openUserModal(null));
  $('btn-user-reset-seed')?.addEventListener('click', async () => {
    if (!isStaticHosting()) {
      flash('API 模式下请通过新建/编辑维护用户，无需恢复预置', false);
      return;
    }
    if (!confirm('恢复预置 admin/user 账号？当前用户库将被覆盖。')) return;
    await resetUsersToSeed();
    appendAuditLog({
      actor: session.username,
      action: 'user_reset_seed',
      result: 'ok',
      summary: '恢复预置用户',
    });
    flash('已恢复预置用户');
    await refreshUsersCache();
    draw();
    renderOverview();
  });
  $('user-table')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const tr = e.target.closest('tr[data-id]');
    if (!btn || !tr) return;
    const id = tr.dataset.id;
    const user = cachedUsers().find((u) => String(u.id) === String(id));
    if (!user) return;
    if (btn.dataset.act === 'edit') openUserModal(user);
    if (btn.dataset.act === 'pwd') {
      const pwd = prompt('输入新密码（默认 123456）', '123456');
      if (pwd == null) return;
      const r = await adminResetPassword(id, pwd || '123456');
      appendAuditLog({
        actor: session.username,
        action: 'user_reset_pwd',
        target: user.username,
        result: r.ok ? 'ok' : 'fail',
        summary: r.ok ? '重置密码' : r.message,
      });
      flash(r.ok ? `已重置 ${user.username} 密码` : r.message, r.ok);
    }
    if (btn.dataset.act === 'del') {
      if (!confirm(`确认删除用户 ${user.username}？`)) return;
      const r = await adminDeleteUser(id, session.username);
      appendAuditLog({
        actor: session.username,
        action: 'user_delete',
        target: user.username,
        result: r.ok ? 'ok' : 'fail',
        summary: r.ok ? '删除用户' : r.message,
      });
      flash(r.ok ? '已删除' : r.message, r.ok);
      await refreshUsersCache();
      draw();
    }
  });
}

function openUserModal(user) {
  const isNew = !user;
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal">
      <h3>${isNew ? '新建用户' : '编辑用户'}</h3>
      <div class="form-grid">
        <label>用户名<input id="m-username" ${isNew ? '' : 'disabled'} value="${user?.username || ''}" /></label>
        <label>显示名<input id="m-display" value="${user?.displayName || ''}" /></label>
        <label>手机号<input id="m-phone" value="${user?.phone || ''}" /></label>
        <label>角色
          <select id="m-role">
            <option value="user" ${user?.role !== 'admin' ? 'selected' : ''}>值班员</option>
            <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>管理员</option>
          </select>
        </label>
        ${
          isNew
            ? '<label>初始密码<input id="m-pwd" type="password" value="123456" /></label>'
            : ''
        }
        <label>状态
          <select id="m-enabled">
            <option value="1" ${user?.enabled !== false ? 'selected' : ''}>启用</option>
            <option value="0" ${user?.enabled === false ? 'selected' : ''}>禁用</option>
          </select>
        </label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" id="m-cancel">取消</button>
        <button type="button" class="btn" id="m-save">保存</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  mask.querySelector('#m-cancel').onclick = () => mask.remove();
  mask.querySelector('#m-save').onclick = async () => {
    const payload = {
      username: mask.querySelector('#m-username').value,
      displayName: mask.querySelector('#m-display').value,
      phone: mask.querySelector('#m-phone').value,
      role: mask.querySelector('#m-role').value,
      enabled: mask.querySelector('#m-enabled').value === '1',
      password: mask.querySelector('#m-pwd')?.value || '123456',
    };
    let r;
    if (isNew) {
      r = await adminCreateUser(payload);
      appendAuditLog({
        actor: session.username,
        action: 'user_create',
        target: payload.username,
        result: r.ok ? 'ok' : 'fail',
        summary: r.ok ? '新建用户' : r.message,
      });
    } else {
      r = await adminUpdateUser(user.id, payload, session.username);
      appendAuditLog({
        actor: session.username,
        action: 'user_update',
        target: user.username,
        result: r.ok ? 'ok' : 'fail',
        summary: r.ok ? '编辑用户' : r.message,
      });
    }
    flash(r.ok ? '已保存' : r.message, r.ok);
    if (r.ok) await refreshUsersCache();
    if (r.ok) {
      mask.remove();
      renderUsers();
    }
  };
}

/* —— 阈值 —— */
function renderThresholds() {
  const th = getEnvThresholds();
  const period = getActivePeriodKey();
  const fields = [
    { key: 'noise', label: '噪声', hint: '厂界 / 作业区声级' },
    { key: 'pm25', label: 'PM2.5', hint: '细颗粒物' },
    { key: 'pm10', label: 'PM10', hint: '可吸入颗粒物' },
    { key: 'dust', label: '粉尘', hint: '总悬浮粉尘' },
  ];

  const periodCard = (mode, title, hours) => {
    const active = mode === period;
    return `
    <section class="thresh-period-card ${active ? 'is-active' : ''}" data-mode="${mode}">
      <header class="thresh-period-hd">
        <div>
          <h3>${title}</h3>
          <p>${hours}</p>
        </div>
        ${active ? '<span class="thresh-badge">当前生效</span>' : '<span class="thresh-badge ghost">未生效时段</span>'}
      </header>
      <div class="thresh-metric-list">
        ${fields
          .map((f) => {
            const rule = (th[mode] && th[mode][f.key]) || {};
            const unit = rule.unit || '';
            return `
            <article class="thresh-metric">
              <div class="thresh-metric-name">
                <strong>${f.label}</strong>
                <span>${f.hint}${unit ? ` · ${unit}` : ''}</span>
              </div>
              <div class="thresh-metric-fields">
                <label class="thresh-field warn">
                  <span>预警</span>
                  <div class="thresh-input-wrap">
                    <input type="number" step="0.1" data-mode="${mode}" data-metric="${f.key}" data-bound="warn" value="${rule.warn ?? ''}" />
                    <i>${unit}</i>
                  </div>
                </label>
                <label class="thresh-field alarm">
                  <span>报警</span>
                  <div class="thresh-input-wrap">
                    <input type="number" step="0.1" data-mode="${mode}" data-metric="${f.key}" data-bound="alarm" value="${rule.alarm ?? ''}" />
                    <i>${unit}</i>
                  </div>
                </label>
              </div>
            </article>`;
          })
          .join('')}
      </div>
    </section>`;
  };

  const box = $('panel-thresholds');
  box.innerHTML = `
    <div class="thresh-page">
      <div class="thresh-page-hd">
        <div>
          <h2>环境阈值配置</h2>
          <p class="muted">昼 / 夜两套阈值并排维护。保存后写入本地，一张图按当前时段重算状态。</p>
        </div>
        <div class="thresh-page-actions">
          <button type="button" class="btn ghost" id="btn-th-reset">恢复默认</button>
          <button type="button" class="btn" id="btn-th-save">应用阈值</button>
        </div>
      </div>
      <div class="thresh-compare">
        ${periodCard('day', '昼间', '06:00 – 22:00')}
        ${periodCard('night', '夜间', '22:00 – 次日 06:00')}
      </div>
      <p class="thresh-foot muted">说明：数值达到「预警」即判 warn，达到「报警」即判 alarm；报警优先级更高。</p>
    </div>`;

  $('btn-th-save')?.addEventListener('click', () => {
    const next = { day: {}, night: {} };
    box.querySelectorAll('input[data-metric]').forEach((input) => {
      const mode = input.dataset.mode;
      const metric = input.dataset.metric;
      const bound = input.dataset.bound;
      if (!next[mode][metric]) {
        const base = (th[mode] && th[mode][metric]) || {};
        next[mode][metric] = { ...base };
      }
      const n = Number(input.value);
      if (Number.isFinite(n)) next[mode][metric][bound] = n;
    });
    saveEnvThresholds(next);
    appendAuditLog({
      actor: session.username,
      action: 'threshold_save',
      result: 'ok',
      summary: '保存环境阈值',
    });
    flash('阈值已保存，大屏将按新阈值生效');
    renderThresholds();
  });
  $('btn-th-reset')?.addEventListener('click', () => {
    resetEnvThresholds();
    if (fileThresholds) initEnvThresholds(fileThresholds);
    appendAuditLog({
      actor: session.username,
      action: 'threshold_reset',
      result: 'ok',
      summary: '恢复默认阈值',
    });
    flash('已恢复默认阈值');
    renderThresholds();
  });
}

/* —— 储量参数 —— */
function renderReservesAdmin() {
  const derived = getReserves();
  const input = getReservesInput();
  const districts = Array.isArray(input.districts) ? input.districts : [];
  const box = $('panel-reserves');
  box.innerHTML = `
    <div class="thresh-page">
      <div class="thresh-page-hd">
        <div>
          <h2>储量参数</h2>
          <p class="muted">数据存于数据库表 <code>cfg_reserves</code>；保存后大屏刷新可见。</p>
          <p class="muted">依据：${input.dataBasis || '（未标注年报）'} · 评估利用 ${input.assessedUtilizedReserve ?? '—'} 万吨 · 采区 ${districts.length} 条</p>
        </div>
        <div class="thresh-page-actions">
          <button type="button" class="btn ghost" id="btn-rsv-reload">从服务器重载</button>
          <button type="button" class="btn ghost" id="btn-rsv-reset">恢复本次加载</button>
          <button type="button" class="btn" id="btn-rsv-save">保存并计算</button>
        </div>
      </div>

      <section class="thresh-period-card is-active">
        <header class="thresh-period-hd">
          <div>
            <h3>可采储量输入</h3>
            <p>可采储量 = 评估利用资源储量 × 设计回采率 × 采矿回采率</p>
          </div>
        </header>
        <div class="thresh-metric-list">
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-name"><strong>评估利用资源储量</strong><span>万吨</span></div>
            <div class="thresh-metric-fields map-fields-1">
              <label class="thresh-field"><span>数值</span>
                <div class="thresh-input-wrap">
                  <input type="number" id="rsv-assessed" step="0.01" min="0" value="${input.assessedUtilizedReserve ?? ''}" />
                  <i>万吨</i>
                </div>
              </label>
            </div>
          </article>
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-name"><strong>回采率</strong><span>0～1 或百分比均可，保存时按小数存</span></div>
            <div class="thresh-metric-fields map-fields-2">
              <label class="thresh-field"><span>设计回采率</span>
                <div class="thresh-input-wrap">
                  <input type="number" id="rsv-design" step="0.01" min="0" max="1" value="${input.designRecoveryRate ?? ''}" />
                </div>
              </label>
              <label class="thresh-field"><span>采矿回采率</span>
                <div class="thresh-input-wrap">
                  <input type="number" id="rsv-mining" step="0.01" min="0" max="1" value="${input.miningRecoveryRate ?? ''}" />
                </div>
              </label>
            </div>
          </article>
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-name"><strong>台账辅助</strong><span>用于剩余可采与服务年限估算</span></div>
            <div class="thresh-metric-fields map-fields-grid">
              <label class="thresh-field"><span>累计已采出</span>
                <div class="thresh-input-wrap">
                  <input type="number" id="rsv-mined" step="0.01" min="0" value="${input.mined ?? ''}" /><i>万吨</i>
                </div>
              </label>
              <label class="thresh-field"><span>日均采出</span>
                <div class="thresh-input-wrap">
                  <input type="number" id="rsv-avg" step="0.001" min="0" value="${input.avgDailyMined ?? ''}" /><i>万吨/日</i>
                </div>
              </label>
              <label class="thresh-field"><span>服务年限预警</span>
                <div class="thresh-input-wrap">
                  <input type="number" id="rsv-warn" step="0.1" min="0" value="${input.warningYears ?? ''}" /><i>年</i>
                </div>
              </label>
            </div>
          </article>
        </div>
      </section>

      <section class="thresh-period-card is-active" style="margin-top:14px">
        <header class="thresh-period-hd">
          <div>
            <h3>采区回采率输入</h3>
            <p>采区回采率 = 采出量 ÷ 动用储量；全矿按采出量加权平均</p>
          </div>
          <button type="button" class="btn ghost" id="btn-rsv-add-dist">添加采区</button>
        </header>
        <div class="table-wrap">
          <table class="data" id="rsv-district-table">
            <thead>
              <tr><th>采区名称</th><th>采出量（万吨）</th><th>动用储量（万吨）</th><th>回采率</th><th></th></tr>
            </thead>
            <tbody>
              ${
                districts.length
                  ? districts
                      .map((d, i) => {
                        const rate =
                          Number(d.activatedReserve) > 0
                            ? ((Number(d.output) || 0) / Number(d.activatedReserve)) * 100
                            : 0;
                        return `<tr data-idx="${i}">
                          <td><input data-f="name" value="${d.name || ''}" /></td>
                          <td><input type="number" data-f="output" step="0.01" min="0" value="${d.output ?? 0}" /></td>
                          <td><input type="number" data-f="activated" step="0.01" min="0" value="${d.activatedReserve ?? 0}" /></td>
                          <td class="rsv-rate-cell">${rate.toFixed(1)}%</td>
                          <td><button type="button" class="btn ghost" data-act="del">删除</button></td>
                        </tr>`;
                      })
                      .join('')
                  : '<tr class="empty"><td colspan="5">暂无采区，请添加</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="thresh-period-card" style="margin-top:14px">
        <header class="thresh-period-hd">
          <div>
            <h3>计算结果（预览）</h3>
            <p>点「保存并计算」写入数据库；添加/删除采区仅改草稿，需再保存</p>
          </div>
        </header>
        <div class="kpi-row" id="rsv-preview">
          <div class="kpi"><span>可采储量</span><b>${derived.recoverableReserve} ${derived.unit}</b></div>
          <div class="kpi"><span>剩余可采</span><b>${derived.remaining} ${derived.unit}</b></div>
          <div class="kpi"><span>全矿回采率</span><b>${derived.mineRecoveryRatePct}</b></div>
          <div class="kpi"><span>预计天数</span><b>${derived.remainingDays}</b></div>
        </div>
      </section>
    </div>`;

  const refreshRates = () => {
    box.querySelectorAll('#rsv-district-table tbody tr[data-idx]').forEach((tr) => {
      const output = Number(tr.querySelector('[data-f="output"]')?.value) || 0;
      const act = Number(tr.querySelector('[data-f="activated"]')?.value) || 0;
      const cell = tr.querySelector('.rsv-rate-cell');
      if (cell) cell.textContent = act > 0 ? `${((output / act) * 100).toFixed(1)}%` : '—';
    });
  };

  const collect = () => {
    const districtsNext = [];
    box.querySelectorAll('#rsv-district-table tbody tr[data-idx]').forEach((tr, i) => {
      districtsNext.push({
        id: districts[i]?.id || `D${i + 1}`,
        name: tr.querySelector('[data-f="name"]')?.value?.trim() || `采区${i + 1}`,
        output: Number(tr.querySelector('[data-f="output"]')?.value) || 0,
        activatedReserve: Number(tr.querySelector('[data-f="activated"]')?.value) || 0,
      });
    });
    return {
      assessedUtilizedReserve: Number($('rsv-assessed')?.value) || 0,
      designRecoveryRate: Number($('rsv-design')?.value) || 0,
      miningRecoveryRate: Number($('rsv-mining')?.value) || 0,
      mined: Number($('rsv-mined')?.value) || 0,
      avgDailyMined: Number($('rsv-avg')?.value) || 0,
      warningYears: Number($('rsv-warn')?.value) || 0,
      unit: input.unit || '万吨',
      districts: districtsNext,
      daily: input.daily,
      trend: input.trend,
      forecast: input.forecast,
    };
  };

  const updatePreview = () => {
    const preview = computeReservesDerived(collect());
    const el = $('rsv-preview');
    if (!el) return;
    el.innerHTML = `
      <div class="kpi"><span>可采储量</span><b>${preview.recoverableReserve} ${preview.unit}</b></div>
      <div class="kpi"><span>剩余可采</span><b>${preview.remaining} ${preview.unit}</b></div>
      <div class="kpi"><span>全矿回采率</span><b>${preview.mineRecoveryRatePct}</b></div>
      <div class="kpi"><span>预计天数</span><b>${preview.remainingDays}</b></div>`;
    refreshRates();
  };

  box.addEventListener('input', (e) => {
    if (e.target.matches('input')) updatePreview();
  });

  $('btn-rsv-add-dist')?.addEventListener('click', () => {
    const payload = collect();
    payload.districts.push({
      id: `D${payload.districts.length + 1}`,
      name: `采区${payload.districts.length + 1}`,
      output: 0,
      activatedReserve: 0,
    });
    draftReservesConfig(payload);
    renderReservesAdmin();
  });

  box.querySelector('#rsv-district-table')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="del"]');
    if (!btn) return;
    const tr = btn.closest('tr[data-idx]');
    if (!tr) return;
    const idx = Number(tr.dataset.idx);
    const payload = collect();
    payload.districts.splice(idx, 1);
    draftReservesConfig(payload);
    renderReservesAdmin();
  });

  $('btn-rsv-save')?.addEventListener('click', async () => {
    const payload = collect();
    if (payload.designRecoveryRate > 1 || payload.miningRecoveryRate > 1) {
      flash('回采率请填写 0～1 之间的小数（如 0.92）', false);
      return;
    }
    try {
      const next = await saveReservesConfig(payload);
      appendAuditLog({
        actor: session.username,
        action: 'reserves_save',
        result: 'ok',
        summary: `保存储量参数 · 可采 ${next.recoverableReserve}${next.unit} · 采区 ${next.districts?.length || 0}`,
      });
      flash(`已写入数据库：可采 ${next.recoverableReserve} ${next.unit}，采区 ${next.districts?.length || 0} 条`);
      renderReservesAdmin();
    } catch (err) {
      flash(err.message || '保存失败', false);
    }
  });

  $('btn-rsv-reload')?.addEventListener('click', async () => {
    try {
      await reloadReservesFromServer();
      flash('已从服务器重新加载储量配置');
      renderReservesAdmin();
    } catch (err) {
      flash(err.message || '重载失败', false);
    }
  });

  $('btn-rsv-reset')?.addEventListener('click', () => {
    resetReserves();
    appendAuditLog({
      actor: session.username,
      action: 'reserves_reset',
      result: 'ok',
      summary: '恢复本次从服务器加载的储量参数',
    });
    flash('已恢复为本次加载的服务器数据（未保存的修改已丢弃）');
    renderReservesAdmin();
  });
}

/* —— 字典 —— */
function renderDict() {
  initDictStore();
  const types = listDictTypes();
  if (!types.find((t) => t.code === selectedDictType) && types[0]) {
    selectedDictType = types[0].code;
  }
  const type = getDictType(selectedDictType);
  const box = $('panel-dict');
  box.innerHTML = `
    <h2>字典管理</h2>
    <div class="toolbar">
      <label>字典类型
        <select id="dict-type">
          ${types.map((t) => `<option value="${t.code}" ${t.code === selectedDictType ? 'selected' : ''}>${t.name} (${t.count})</option>`).join('')}
        </select>
      </label>
      <button type="button" class="btn" id="btn-dict-add">新增/编辑项</button>
      <button type="button" class="btn ghost" id="btn-dict-reset">恢复默认字典</button>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>code</th><th>显示名</th><th>排序</th><th>启用</th><th>备注</th><th>操作</th></tr></thead>
        <tbody>
          ${(type?.items || [])
            .map(
              (i) => `<tr data-code="${i.code}">
              <td>${i.code}</td><td>${i.label}</td><td>${i.sort ?? 0}</td>
              <td>${i.enabled === false ? '否' : '是'}</td><td>${i.note || ''}</td>
              <td class="ops">
                <button type="button" class="btn ghost" data-act="edit">编辑</button>
                <button type="button" class="btn danger" data-act="del">删除</button>
              </td></tr>`
            )
            .join('') || '<tr><td colspan="6">无字典项</td></tr>'}
        </tbody>
      </table>
    </div>`;

  $('dict-type')?.addEventListener('change', (e) => {
    selectedDictType = e.target.value;
    renderDict();
  });
  $('btn-dict-reset')?.addEventListener('click', () => {
    if (!confirm('恢复默认字典？')) return;
    resetDictStore();
    appendAuditLog({
      actor: session.username,
      action: 'dict_reset',
      result: 'ok',
      summary: '恢复默认字典',
    });
    flash('字典已重置');
    renderDict();
  });
  $('btn-dict-add')?.addEventListener('click', () => openDictModal(null));
  box.querySelector('tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const tr = e.target.closest('tr[data-code]');
    if (!btn || !tr) return;
    const item = (type?.items || []).find((i) => i.code === tr.dataset.code);
    if (btn.dataset.act === 'edit') openDictModal(item);
    if (btn.dataset.act === 'del') {
      if (!confirm(`删除字典项 ${tr.dataset.code}？`)) return;
      const r = deleteDictItem(selectedDictType, tr.dataset.code);
      appendAuditLog({
        actor: session.username,
        action: 'dict_delete',
        target: `${selectedDictType}.${tr.dataset.code}`,
        result: r.ok ? 'ok' : 'fail',
        summary: r.ok ? '删除字典项' : r.message,
      });
      flash(r.ok ? '已删除' : r.message, r.ok);
      renderDict();
    }
  });
}

function openDictModal(item) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal">
      <h3>${item ? '编辑字典项' : '新增字典项'} · ${selectedDictType}</h3>
      <div class="form-grid">
        <label>code<input id="d-code" ${item ? 'disabled' : ''} value="${item?.code || ''}" /></label>
        <label>显示名<input id="d-label" value="${item?.label || ''}" /></label>
        <label>排序<input id="d-sort" type="number" value="${item?.sort ?? 0}" /></label>
        <label>启用
          <select id="d-enabled">
            <option value="1" ${item?.enabled !== false ? 'selected' : ''}>是</option>
            <option value="0" ${item?.enabled === false ? 'selected' : ''}>否</option>
          </select>
        </label>
        <label class="full">备注<input id="d-note" value="${item?.note || ''}" /></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" id="d-cancel">取消</button>
        <button type="button" class="btn" id="d-save">保存</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  mask.querySelector('#d-cancel').onclick = () => mask.remove();
  mask.querySelector('#d-save').onclick = () => {
    const r = upsertDictItem(selectedDictType, {
      code: mask.querySelector('#d-code').value,
      label: mask.querySelector('#d-label').value,
      sort: mask.querySelector('#d-sort').value,
      enabled: mask.querySelector('#d-enabled').value === '1',
      note: mask.querySelector('#d-note').value,
    });
    appendAuditLog({
      actor: session.username,
      action: 'dict_upsert',
      target: `${selectedDictType}.${mask.querySelector('#d-code').value}`,
      result: r.ok ? 'ok' : 'fail',
      summary: r.ok ? '保存字典项' : r.message,
    });
    flash(r.ok ? '字典已保存' : r.message, r.ok);
    if (r.ok) {
      mask.remove();
      renderDict();
    }
  };
}

/* —— 地图 —— */
function renderMaps() {
  const cfg = mergeMapConfig(fileMapConfig);
  const box = $('panel-maps');
  const rows = Object.entries(cfg.basemaps || {});
  const hasTk = Boolean(String(cfg.tiandituTk || '').trim());

  box.innerHTML = `
    <div class="thresh-page">
      <div class="thresh-page-hd">
        <div>
          <h2>地图源与密钥</h2>
          <p class="muted">维护底图启用、缩放与瓦片地址；天地图需填写密钥。保存后刷新一张图生效。</p>
        </div>
        <div class="thresh-page-actions">
          <button type="button" class="btn ghost" id="btn-map-reset">清除本地覆盖</button>
          <button type="button" class="btn" id="btn-map-save">保存地图配置</button>
        </div>
      </div>

      <section class="thresh-period-card is-active" style="margin-bottom:14px">
        <header class="thresh-period-hd">
          <div>
            <h3>全局设置</h3>
            <p>默认底图 · 最小缩放 · 天地图密钥</p>
          </div>
          <span class="thresh-badge ${hasTk ? '' : 'ghost'}">${hasTk ? '天地图密钥已填' : '天地图密钥未填'}</span>
        </header>
        <div class="thresh-metric-list">
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-name">
              <strong>默认底图</strong>
              <span>一张图首次加载优先使用</span>
            </div>
            <div class="thresh-metric-fields map-fields-2">
              <label class="thresh-field">
                <span>底图源</span>
                <div class="thresh-input-wrap">
                  <select id="map-default">
                    ${rows
                      .map(
                        ([id, b]) =>
                          `<option value="${id}" ${cfg.defaultBasemap === id ? 'selected' : ''}>${b.label || id}</option>`
                      )
                      .join('')}
                  </select>
                </div>
              </label>
              <label class="thresh-field">
                <span>全局最小缩放</span>
                <div class="thresh-input-wrap">
                  <input type="number" id="map-minz" value="${cfg.mapMinZoom ?? 3}" />
                  <i>级</i>
                </div>
              </label>
            </div>
          </article>
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-name">
              <strong>天地图密钥</strong>
              <span>tiandituTk · 矢量 / 影像共用</span>
            </div>
            <div class="thresh-metric-fields map-fields-1">
              <label class="thresh-field">
                <span>密钥</span>
                <div class="thresh-input-wrap">
                  <input type="password" id="map-tk" value="${cfg.tiandituTk || ''}" placeholder="留空则天地图不可用" />
                  <button type="button" class="thresh-affix-btn" id="btn-tk-toggle">显示</button>
                </div>
              </label>
            </div>
          </article>
        </div>
      </section>

      <section class="thresh-period-card">
        <header class="thresh-period-hd">
          <div>
            <h3>底图源列表</h3>
            <p>共 ${rows.length} 个源 · 可改显示名、启用与地址</p>
          </div>
        </header>
        <div class="thresh-metric-list" id="map-source-list">
          ${rows
            .map(([id, b]) => {
              const enabled = b.enabled !== false;
              return `
              <article class="thresh-metric map-source-row" data-id="${id}">
                <div class="thresh-metric-name">
                  <strong>${b.label || id}</strong>
                  <span><code>${id}</code>${b.kind === 'tianditu' ? ' · 天地图' : ''}</span>
                  <label class="map-enable">
                    <input type="checkbox" data-f="enabled" ${enabled ? 'checked' : ''} />
                    启用
                  </label>
                </div>
                <div class="thresh-metric-fields map-fields-grid">
                  <label class="thresh-field">
                    <span>显示名</span>
                    <div class="thresh-input-wrap">
                      <input data-f="label" value="${b.label || ''}" />
                    </div>
                  </label>
                  <label class="thresh-field">
                    <span>最小缩放</span>
                    <div class="thresh-input-wrap">
                      <input type="number" data-f="minZoom" value="${b.minZoom ?? 3}" />
                      <i>级</i>
                    </div>
                  </label>
                  <label class="thresh-field">
                    <span>最大缩放</span>
                    <div class="thresh-input-wrap">
                      <input type="number" data-f="maxZoom" value="${b.maxZoom ?? 18}" />
                      <i>级</i>
                    </div>
                  </label>
                  <label class="thresh-field map-field-wide">
                    <span>地址模板</span>
                    <div class="thresh-input-wrap">
                      <input data-f="urlTemplate" value="${b.urlTemplate || ''}" placeholder="可选覆盖，天地图可留空" />
                    </div>
                  </label>
                  <label class="thresh-field">
                    <span>子域</span>
                    <div class="thresh-input-wrap">
                      <input data-f="subdomains" value="${b.subdomains || ''}" placeholder="如 abc" />
                    </div>
                  </label>
                </div>
              </article>`;
            })
            .join('')}
        </div>
      </section>
      <p class="thresh-foot muted">说明：无天地图密钥时，大屏切换天地图会提示不可用；「清除本地覆盖」将回退到 map-config.json。</p>
    </div>`;

  $('btn-tk-toggle')?.addEventListener('click', () => {
    const input = $('map-tk');
    const btn = $('btn-tk-toggle');
    if (!input || !btn) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '隐藏' : '显示';
  });
  $('btn-map-save')?.addEventListener('click', () => {
    const next = {
      defaultBasemap: $('map-default').value,
      mapMinZoom: Number($('map-minz').value) || 3,
      tiandituTk: $('map-tk').value.trim(),
      basemaps: {},
    };
    box.querySelectorAll('.map-source-row[data-id]').forEach((row) => {
      const id = row.dataset.id;
      next.basemaps[id] = {
        label: row.querySelector('[data-f="label"]').value,
        enabled: row.querySelector('[data-f="enabled"]').checked,
        minZoom: Number(row.querySelector('[data-f="minZoom"]').value) || 3,
        maxZoom: Number(row.querySelector('[data-f="maxZoom"]').value) || 18,
        maxNativeZoom: Number(row.querySelector('[data-f="maxZoom"]').value) || 18,
        urlTemplate: row.querySelector('[data-f="urlTemplate"]').value,
        subdomains: row.querySelector('[data-f="subdomains"]').value,
      };
    });
    if (!next.tiandituTk && (next.defaultBasemap === 'tdt-vec' || next.defaultBasemap === 'tdt-img')) {
      flash('默认底图为天地图但密钥为空，请填写 tiandituTk 或改默认底图', false);
      return;
    }
    saveMapConfigOverride(toPersistedMapConfig(next));
    appendAuditLog({
      actor: session.username,
      action: 'map_config_save',
      result: 'ok',
      summary: `保存地图配置 · 默认 ${next.defaultBasemap}`,
    });
    flash('地图配置已保存');
    renderMaps();
  });
  $('btn-map-reset')?.addEventListener('click', () => {
    clearMapConfigOverride();
    appendAuditLog({
      actor: session.username,
      action: 'map_config_reset',
      result: 'ok',
      summary: '清除地图本地覆盖',
    });
    flash('已清除本地覆盖');
    renderMaps();
  });
}

/* —— 数据接入：连接 / 站点策略 / 测试 —— */
function field(label, html) {
  return `<label class="thresh-field"><span>${label}</span><div class="thresh-input-wrap">${html}</div></label>`;
}

async function loadBridgeCfg() {
  if (isStaticHosting()) return mergeSensorConfig(fileSensorConfig);
  const r = await apiGet('/api/admin/sensors/bridge');
  return r.ok && r.data ? r.data : {};
}

async function loadPolicy() {
  if (isStaticHosting()) {
    const c = mergeSensorConfig(fileSensorConfig);
    return {
      enabled: c.ingest?.enabled !== false,
      demoPushEnabled: Boolean(c.ingest?.demoPushEnabled),
      demoPushIntervalSec: Math.max(30, Number(c.ingest?.demoPushIntervalSec) || 30),
      envRetentionMonths: 3,
      thresholds: c.thresholds || { noiseDay: 60, noiseNight: 50, pm25: 75, pm10: 150 },
    };
  }
  const r = await apiGet('/api/admin/sensors/policy');
  return r.ok && r.data ? r.data : {};
}

async function loadStations() {
  if (isStaticHosting()) {
    const c = mergeSensorConfig(fileSensorConfig);
    return (c.environmentStations || []).map((s) => ({
      id: s.id,
      name: s.name,
      location: s.location,
      lng: s.lng,
      lat: s.lat,
      clientId: (s.clientIds && s.clientIds[0]) || '',
      enabled: true,
    }));
  }
  const r = await apiGet('/api/admin/sensors/stations');
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

async function loadSlopeDevices() {
  if (isStaticHosting()) {
    const c = mergeSensorConfig(fileSensorConfig);
    const out = [];
    const m = c.slopeDevices || {};
    Object.keys(m).forEach((sn) => {
      out.push({
        deviceSn: sn,
        externalId: m[sn].id,
        name: m[sn].name,
        deviceKind: m[sn].type || 'displacement',
        enabled: true,
      });
    });
    return out;
  }
  const r = await apiGet('/api/admin/sensors/slope-devices');
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

function collectBridgeForm(box) {
  const g = (name) => box.querySelector(`[name="${name}"]`);
  const num = (name, fallback) => {
    const n = Number(g(name)?.value);
    return Number.isFinite(n) ? n : fallback;
  };
  const mode = box.querySelector('[name="http-mode"]:checked')?.value || 'direct';
  return {
    tcp: {
      enabled: Boolean(g('tcp-enabled')?.checked),
      host: (g('tcp-host')?.value || '').trim() || '0.0.0.0',
      port: num('tcp-port', 9000),
      frameHint: (g('tcp-hint')?.value || '').trim(),
    },
    http: {
      enabled: g('http-enabled')?.checked !== false,
      host: (g('http-host')?.value || '').trim() || '0.0.0.0',
      port: num('http-port', 5173),
      pushPath: (g('http-path')?.value || '').trim() || '/api/push',
      staticDir: (g('http-static')?.value || '').trim() || '../frontend',
      mode,
      publicBaseUrl: (g('http-public')?.value || '').trim(),
      pushToken: (g('http-token')?.value || '').trim(),
      cloud: {
        baseUrl: (g('cloud-base')?.value || '').trim(),
        pullPath: (g('cloud-pull')?.value || '').trim() || '/api/relay/latest',
        sincePath: (g('cloud-since')?.value || '').trim() || '/api/relay/since',
        token: (g('cloud-token')?.value || '').trim(),
        pullIntervalSec: Math.max(30, num('cloud-interval', 30)),
        backfillEnabled: g('cloud-backfill')?.checked !== false,
        retentionHoursOnCloud: Math.max(1, num('cloud-retain', 24)),
      },
    },
    mqtt: {
      enabled: g('mqtt-enabled')?.checked !== false,
      host: (g('mqtt-host')?.value || '').trim(),
      port: num('mqtt-port', 1883),
      username: (g('mqtt-user')?.value || '').trim(),
      password: g('mqtt-pass')?.value || '',
      clientId: (g('mqtt-client')?.value || '').trim() || 'mine-onemap-api',
      topics: parseMqttTopics(g('mqtt-topics')?.value),
      topic: (g('mqtt-topic')?.value || '').trim(),
      keepalive: Math.max(30, num('mqtt-keep', 60)),
      reconnectDelaySec: Math.max(30, num('mqtt-reconn', 30)),
    },
  };
}

/** 多行 / 逗号 / 分号分隔的 Topic 列表 */
function parseMqttTopics(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatMqttTopics(cfg) {
  const arr = Array.isArray(cfg?.mqtt?.topics) ? cfg.mqtt.topics.filter(Boolean) : [];
  if (arr.length) return arr.join('\n');
  const single = (cfg?.mqtt?.topic || '').trim();
  if (!single) return '';
  return single.split(/[,;]+/).map((s) => s.trim()).filter(Boolean).join('\n');
}

async function renderSensorConnect() {
  const cfg = await loadBridgeCfg();
  const mqttOn = cfg.mqtt?.enabled !== false;
  const httpOn = cfg.http?.enabled !== false;
  const tcpOn = Boolean(cfg.tcp?.enabled);
  const mode = cfg.http?.mode === 'cloud_relay' ? 'cloud_relay' : 'direct';
  const cloud = cfg.http?.cloud || {};
  const staticDemo = isStaticHosting();
  const box = $('panel-sensor-connect');
  const base = (cfg.http?.publicBaseUrl || '').replace(/\/+$/, '');
  const path = cfg.http?.pushPath || '/api/push';
  const publicUrl = base ? base + path : path;
  box.innerHTML = `
    <div class="thresh-page">
      <div class="thresh-page-hd">
        <div>
          <h2>接入连接</h2>
          <p class="muted">仅配置 MQTT / HTTP / TCP 通道（写入 cfg_sensor_bridge）。站点映射请到「站点与策略」。</p>
        </div>
        <div class="thresh-page-actions">
          <button type="button" class="btn" id="btn-bridge-save" ${staticDemo ? 'disabled' : ''}>保存连接</button>
        </div>
      </div>

      <section class="thresh-period-card is-active" style="margin-bottom:14px">
        <header class="thresh-period-hd"><div><h3>HTTP 接收模式</h3><p>公网直收 或 云端中转拉取</p></div></header>
        <div class="thresh-metric-list">
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-fields map-fields-2">
              <label class="map-enable"><input type="radio" name="http-mode" value="direct" ${mode === 'direct' ? 'checked' : ''} /> 模式 A · 本机公网直收</label>
              <label class="map-enable"><input type="radio" name="http-mode" value="cloud_relay" ${mode === 'cloud_relay' ? 'checked' : ''} /> 模式 B · 云端中转</label>
            </div>
          </article>
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-name"><strong>公网地址</strong><span>给厂商的推送前缀</span></div>
            <div class="thresh-metric-fields map-fields-2">
              ${field('publicBaseUrl', `<input name="http-public" value="${escapeHtml(cfg.http?.publicBaseUrl || '')}" placeholder="https://x.x.x.x:8081" />`)}
              ${field('Push Token', `<input name="http-token" value="${escapeHtml(cfg.http?.pushToken || '')}" placeholder="可选 X-Push-Token" />`)}
            </div>
          </article>
          <p class="muted" style="padding:0 12px 8px">完整推送 URL：<code id="bridge-push-url">${escapeHtml(publicUrl)}</code></p>
        </div>
      </section>

      <div class="thresh-compare">
        <section class="thresh-period-card ${mqttOn ? 'is-active' : ''}">
          <header class="thresh-period-hd">
            <div><h3>MQTT</h3><p>边坡 GNSS / 雨量</p></div>
            <label class="map-enable" style="margin:0"><input type="checkbox" name="mqtt-enabled" ${mqttOn ? 'checked' : ''} /> 启用</label>
          </header>
          <div class="thresh-metric-list">
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-fields map-fields-2">
                ${field('主机', `<input name="mqtt-host" value="${escapeHtml(cfg.mqtt?.host || '')}" />`)}
                ${field('端口', `<input type="number" name="mqtt-port" value="${cfg.mqtt?.port ?? 1883}" />`)}
              </div>
            </article>
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-fields map-fields-2">
                ${field('用户名', `<input name="mqtt-user" value="${escapeHtml(cfg.mqtt?.username || '')}" />`)}
                ${field('密码', `<input type="password" name="mqtt-pass" value="${escapeHtml(cfg.mqtt?.password || '')}" />`)}
              </div>
            </article>
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-fields map-fields-2">
                ${field('ClientId', `<input name="mqtt-client" value="${escapeHtml(cfg.mqtt?.clientId || '')}" />`)}
                ${field('兼容单 Topic', `<input name="mqtt-topic" value="${escapeHtml(cfg.mqtt?.topic || '')}" placeholder="可空；多 Topic 优先用下方列表" />`)}
              </div>
            </article>
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-name"><strong>Topics</strong><span>每行一个，或逗号分隔</span></div>
              <div class="thresh-metric-fields">
                <textarea name="mqtt-topics" rows="3" style="width:100%;font-family:Consolas,monospace" placeholder="$iot/an20260811/gnss&#10;$iot/an20260811/YK">${escapeHtml(formatMqttTopics(cfg))}</textarea>
              </div>
            </article>
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-fields map-fields-2">
                ${field('Keepalive', `<input type="number" name="mqtt-keep" value="${cfg.mqtt?.keepalive ?? 60}" /><i>秒</i>`)}
                ${field('重连间隔', `<input type="number" name="mqtt-reconn" value="${cfg.mqtt?.reconnectDelaySec ?? 30}" /><i>秒</i>`)}
              </div>
            </article>
          </div>
        </section>

        <section class="thresh-period-card ${httpOn || tcpOn ? 'is-active' : ''}">
          <header class="thresh-period-hd"><div><h3>HTTP / TCP</h3><p>环境推送与预留 TCP</p></div></header>
          <div class="thresh-metric-list">
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-name">
                <strong>HTTP</strong>
                <label class="map-enable"><input type="checkbox" name="http-enabled" ${httpOn ? 'checked' : ''} /> 启用</label>
              </div>
              <div class="thresh-metric-fields map-fields-grid">
                ${field('监听地址', `<input name="http-host" value="${escapeHtml(cfg.http?.host || '0.0.0.0')}" />`)}
                ${field('端口', `<input type="number" name="http-port" value="${cfg.http?.port ?? 5173}" />`)}
                ${field('推送路径', `<input name="http-path" value="${escapeHtml(cfg.http?.pushPath || '/api/push')}" />`)}
                ${field('staticDir', `<input name="http-static" value="${escapeHtml(cfg.http?.staticDir || '../frontend')}" />`)}
              </div>
            </article>
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-name">
                <strong>云机（模式 B）</strong>
                <label class="map-enable"><input type="checkbox" name="cloud-backfill" ${cloud.backfillEnabled !== false ? 'checked' : ''} /> 断线补拉</label>
              </div>
              <div class="thresh-metric-fields map-fields-grid">
                ${field('云机 baseUrl', `<input name="cloud-base" value="${escapeHtml(cloud.baseUrl || '')}" placeholder="http://云公网:端口" />`)}
                ${field('拉取间隔', `<input type="number" name="cloud-interval" min="30" value="${cloud.pullIntervalSec ?? 30}" /><i>秒</i>`)}
                ${field('latest 路径', `<input name="cloud-pull" value="${escapeHtml(cloud.pullPath || '/api/relay/latest')}" />`)}
                ${field('since 路径', `<input name="cloud-since" value="${escapeHtml(cloud.sincePath || '/api/relay/since')}" />`)}
                ${field('云机 Token', `<input name="cloud-token" value="${escapeHtml(cloud.token || '')}" />`)}
                ${field('云缓冲小时', `<input type="number" name="cloud-retain" value="${cloud.retentionHoursOnCloud ?? 24}" />`)}
              </div>
            </article>
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-name">
                <strong>TCP（预留）</strong>
                <label class="map-enable"><input type="checkbox" name="tcp-enabled" ${tcpOn ? 'checked' : ''} /> 启用</label>
              </div>
              <div class="thresh-metric-fields map-fields-grid">
                ${field('地址', `<input name="tcp-host" value="${escapeHtml(cfg.tcp?.host || '0.0.0.0')}" />`)}
                ${field('端口', `<input type="number" name="tcp-port" value="${cfg.tcp?.port ?? 9000}" />`)}
                ${field('帧说明', `<input name="tcp-hint" value="${escapeHtml(cfg.tcp?.frameHint || '')}" />`)}
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>`;

  $('btn-bridge-save')?.addEventListener('click', async () => {
    const body = collectBridgeForm(box);
    if (isStaticHosting()) {
      flash('未连接后端', false);
      return;
    }
    const r = await apiPut('/api/admin/sensors/bridge', body);
    if (!r.ok) {
      flash(r.message || '保存失败', false);
      return;
    }
    flash('连接配置已保存');
    renderSensorConnect();
  });
}

async function renderSensorMapping() {
  const [policy, stations, devices] = await Promise.all([loadPolicy(), loadStations(), loadSlopeDevices()]);
  const staticDemo = isStaticHosting();
  const box = $('panel-sensor-mapping');
  const th = policy.thresholds || {};
  const stationRows = (stations || [])
    .map(
      (s, i) => `<tr>
      <td><input name="st-id-${i}" value="${escapeHtml(s.id || '')}" /></td>
      <td><input name="st-name-${i}" value="${escapeHtml(s.name || '')}" /></td>
      <td><input name="st-loc-${i}" value="${escapeHtml(s.location || '')}" /></td>
      <td><input name="st-client-${i}" value="${escapeHtml(s.clientId || '')}" /></td>
      <td><input type="number" step="any" name="st-lng-${i}" value="${s.lng ?? ''}" /></td>
      <td><input type="number" step="any" name="st-lat-${i}" value="${s.lat ?? ''}" /></td>
    </tr>`
    )
    .join('');
  const deviceRows = (devices || [])
    .map(
      (d, i) => `<tr>
      <td><input name="dv-sn-${i}" value="${escapeHtml(d.deviceSn || '')}" /></td>
      <td><input name="dv-ext-${i}" value="${escapeHtml(d.externalId || '')}" /></td>
      <td><input name="dv-name-${i}" value="${escapeHtml(d.name || '')}" /></td>
      <td>
        <select name="dv-kind-${i}">
          <option value="displacement" ${d.deviceKind === 'displacement' ? 'selected' : ''}>displacement</option>
          <option value="rainfall" ${d.deviceKind === 'rainfall' ? 'selected' : ''}>rainfall</option>
        </select>
      </td>
    </tr>`
    )
    .join('');
  box.innerHTML = `
    <div class="thresh-page">
      <div class="thresh-page-hd">
        <div>
          <h2>站点与策略</h2>
          <p class="muted">接收开关、站点 / 设备映射、传感器阈值与保留月数（列式表）。</p>
        </div>
        <div class="thresh-page-actions">
          <button type="button" class="btn" id="btn-mapping-save" ${staticDemo ? 'disabled' : ''}>保存策略与映射</button>
        </div>
      </div>

      <section class="thresh-period-card ${policy.enabled !== false ? 'is-active' : ''}" style="margin-bottom:14px">
        <header class="thresh-period-hd">
          <div><h3>接收策略</h3><p>总开关与演示推送</p></div>
          <label class="map-enable" style="margin:0">
            <input type="checkbox" name="ingest-enabled" ${policy.enabled !== false ? 'checked' : ''} />
            ${policy.enabled !== false ? '正在接收' : '已停止'}
          </label>
        </header>
        <div class="thresh-metric-list">
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-name">
              <strong>定时模拟</strong>
              <label class="map-enable"><input type="checkbox" name="demo-push-enabled" ${policy.demoPushEnabled ? 'checked' : ''} /> 启用</label>
            </div>
            <div class="thresh-metric-fields map-fields-2">
              ${field('间隔秒', `<input type="number" name="demo-push-interval" min="30" value="${Math.max(30, policy.demoPushIntervalSec || 30)}" />`)}
              ${field('环境保留月数', `<input type="number" name="env-retain-months" min="1" value="${Math.max(1, policy.envRetentionMonths || 3)}" />`)}
            </div>
          </article>
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-name"><strong>传感器阈值</strong><span>噪声 / PM</span></div>
            <div class="thresh-metric-fields map-fields-grid">
              ${field('噪声昼', `<input type="number" name="th-noise-day" value="${th.noiseDay ?? 60}" />`)}
              ${field('噪声夜', `<input type="number" name="th-noise-night" value="${th.noiseNight ?? 50}" />`)}
              ${field('PM2.5', `<input type="number" name="th-pm25" value="${th.pm25 ?? 75}" />`)}
              ${field('PM10', `<input type="number" name="th-pm10" value="${th.pm10 ?? 150}" />`)}
            </div>
          </article>
        </div>
      </section>

      <section class="thresh-period-card" style="margin-bottom:14px">
        <header class="thresh-period-hd"><div><h3>环境站点</h3><p>cfg_env_station</p></div>
          <button type="button" class="btn ghost" id="btn-add-station">加一行</button>
        </header>
        <div class="table-wrap">
          <table class="data" id="station-table">
            <thead><tr><th>ID</th><th>名称</th><th>位置</th><th>clientId</th><th>经度</th><th>纬度</th></tr></thead>
            <tbody id="station-tbody">${stationRows || ''}</tbody>
          </table>
        </div>
      </section>

      <section class="thresh-period-card">
        <header class="thresh-period-hd"><div><h3>边坡 / 雨量设备</h3><p>cfg_slope_device</p></div>
          <button type="button" class="btn ghost" id="btn-add-device">加一行</button>
        </header>
        <div class="table-wrap">
          <table class="data" id="device-table">
            <thead><tr><th>deviceSn</th><th>外部ID</th><th>名称</th><th>类型</th></tr></thead>
            <tbody id="device-tbody">${deviceRows || ''}</tbody>
          </table>
        </div>
      </section>
    </div>`;

  $('btn-add-station')?.addEventListener('click', () => {
    const tb = $('station-tbody');
    const i = tb.querySelectorAll('tr').length;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input name="st-id-${i}" /></td><td><input name="st-name-${i}" /></td><td><input name="st-loc-${i}" /></td><td><input name="st-client-${i}" /></td><td><input type="number" step="any" name="st-lng-${i}" /></td><td><input type="number" step="any" name="st-lat-${i}" /></td>`;
    tb.appendChild(tr);
  });
  $('btn-add-device')?.addEventListener('click', () => {
    const tb = $('device-tbody');
    const i = tb.querySelectorAll('tr').length;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input name="dv-sn-${i}" /></td><td><input name="dv-ext-${i}" /></td><td><input name="dv-name-${i}" /></td><td><select name="dv-kind-${i}"><option value="displacement">displacement</option><option value="rainfall">rainfall</option></select></td>`;
    tb.appendChild(tr);
  });

  $('btn-mapping-save')?.addEventListener('click', async () => {
    if (isStaticHosting()) {
      flash('未连接后端', false);
      return;
    }
    const g = (name) => box.querySelector(`[name="${name}"]`);
    const policyBody = {
      enabled: g('ingest-enabled')?.checked !== false,
      demoPushEnabled: Boolean(g('demo-push-enabled')?.checked),
      demoPushIntervalSec: Math.max(30, Number(g('demo-push-interval')?.value) || 30),
      envRetentionMonths: Math.max(1, Number(g('env-retain-months')?.value) || 3),
      thresholds: {
        noiseDay: Number(g('th-noise-day')?.value) || 60,
        noiseNight: Number(g('th-noise-night')?.value) || 50,
        pm25: Number(g('th-pm25')?.value) || 75,
        pm10: Number(g('th-pm10')?.value) || 150,
      },
    };
    const stCount = box.querySelectorAll('#station-tbody tr').length;
    const stationsBody = [];
    for (let i = 0; i < stCount; i++) {
      const id = g(`st-id-${i}`)?.value?.trim();
      if (!id) continue;
      const row = {
        id,
        name: g(`st-name-${i}`)?.value?.trim() || id,
        location: g(`st-loc-${i}`)?.value?.trim(),
        clientId: g(`st-client-${i}`)?.value?.trim(),
        enabled: true,
        sortNo: i + 1,
      };
      const lng = Number(g(`st-lng-${i}`)?.value);
      const lat = Number(g(`st-lat-${i}`)?.value);
      if (Number.isFinite(lng)) row.lng = lng;
      if (Number.isFinite(lat)) row.lat = lat;
      stationsBody.push(row);
    }
    const dvCount = box.querySelectorAll('#device-tbody tr').length;
    const devicesBody = [];
    for (let i = 0; i < dvCount; i++) {
      const deviceSn = g(`dv-sn-${i}`)?.value?.trim();
      if (!deviceSn) continue;
      devicesBody.push({
        deviceSn,
        externalId: g(`dv-ext-${i}`)?.value?.trim(),
        name: g(`dv-name-${i}`)?.value?.trim() || deviceSn,
        deviceKind: g(`dv-kind-${i}`)?.value || 'displacement',
        enabled: true,
        sortNo: i + 1,
      });
    }

    const r1 = await apiPut('/api/admin/sensors/policy', policyBody);
    if (!r1.ok) {
      flash(r1.message || '策略保存失败', false);
      return;
    }
    const r2 = await apiPut('/api/admin/sensors/stations', stationsBody);
    if (!r2.ok) {
      flash(r2.message || '站点保存失败', false);
      return;
    }
    const r3 = await apiPut('/api/admin/sensors/slope-devices', devicesBody);
    if (!r3.ok) {
      flash(r3.message || '设备保存失败', false);
      return;
    }
    flash('策略与映射已保存');
    renderSensorMapping();
  });
}

async function renderSensorTest() {
  const staticDemo = isStaticHosting();
  const box = $('panel-sensor-test');
  box.innerHTML = `
    <div class="thresh-page">
      <div class="thresh-page-hd">
        <div>
          <h2>接入测试</h2>
          <p class="muted">测试推送、状态刷新、云机拉取。配置请到「接入连接 / 站点与策略」。</p>
        </div>
        <div class="thresh-page-actions">
          <button type="button" class="btn ghost" id="btn-sensor-status" ${staticDemo ? 'disabled' : ''}>刷新状态</button>
          <button type="button" class="btn ghost" id="btn-cloud-health" ${staticDemo ? 'disabled' : ''}>测云机连通</button>
          <button type="button" class="btn ghost" id="btn-cloud-pull" ${staticDemo ? 'disabled' : ''}>立即拉取云机</button>
          <button type="button" class="btn" id="btn-sensor-test-push" ${staticDemo ? 'disabled' : ''}>发送测试推送</button>
        </div>
      </div>
      <section class="thresh-period-card is-active">
        <div class="sensor-test-grid">
          <div class="sensor-test-payload">
            <label class="thresh-field map-field-wide">
              <span>推送 JSON</span>
              <div class="thresh-input-wrap">
                <textarea id="sensor-test-json" rows="14" spellcheck="false">${escapeHtml(
                  DEFAULT_TEST_PUSH_JSON.replace(
                    'REPLACE_TIME',
                    new Date().toISOString().slice(0, 19).replace('T', ' ')
                  )
                )}</textarea>
              </div>
            </label>
            <div class="sensor-test-actions">
              <button type="button" class="btn ghost" id="btn-sensor-fill-sample">填入样例</button>
              <button type="button" class="btn ghost" id="btn-sensor-clear-msg">清空消息</button>
            </div>
          </div>
          <div class="sensor-msg-panel">
            <div class="sensor-msg-title">互动消息</div>
            <div id="sensor-msg-log" class="sensor-msg-log" aria-live="polite"></div>
          </div>
        </div>
      </section>
      <p class="thresh-foot muted">正式推送 <code>POST /api/push</code>；测试 <code>POST /api/admin/sensors/test-push</code>。数据落列式表 biz_env_latest。</p>
    </div>`;

  paintSensorMsgLog();

  $('btn-sensor-fill-sample')?.addEventListener('click', () => {
    const ta = $('sensor-test-json');
    if (!ta) return;
    ta.value = DEFAULT_TEST_PUSH_JSON.replace(
      'REPLACE_TIME',
      new Date().toISOString().slice(0, 19).replace('T', ' ')
    );
    pushSensorMsg('info', '已填入默认环境监测样例 JSON');
  });
  $('btn-sensor-clear-msg')?.addEventListener('click', () => {
    sensorMsgLog = [];
    paintSensorMsgLog();
    flash('消息已清空');
  });
  $('btn-sensor-status')?.addEventListener('click', async () => {
    const r = await apiGet('/api/admin/sensors/live-status');
    if (!r.ok) {
      pushSensorMsg('err', r.message || '状态查询失败');
      return;
    }
    pushSensorMsg('ok', formatStatusBrief(r.data), JSON.stringify(r.data, null, 2));
    flash('接入状态已刷新');
  });
  $('btn-cloud-health')?.addEventListener('click', async () => {
    const r = await apiGet('/api/admin/sensors/cloud-health');
    if (!r.ok) {
      pushSensorMsg('err', r.message || '云机检测失败');
      return;
    }
    pushSensorMsg(r.data?.ok ? 'ok' : 'err', '云机健康检查', JSON.stringify(r.data, null, 2));
  });
  $('btn-cloud-pull')?.addEventListener('click', async () => {
    const r = await apiPost('/api/admin/sensors/pull-now', {});
    if (!r.ok) {
      pushSensorMsg('err', r.message || '拉取失败');
      flash(r.message || '拉取失败', false);
      return;
    }
    pushSensorMsg('ok', `已拉取 ${r.data?.pulled ?? 0} 条`, JSON.stringify(r.data, null, 2));
    flash('云机拉取完成');
  });
  $('btn-sensor-test-push')?.addEventListener('click', async () => {
    const ta = $('sensor-test-json');
    let payload;
    try {
      payload = JSON.parse((ta?.value || '').trim() || '{}');
    } catch (e) {
      pushSensorMsg('err', 'JSON 解析失败', String(e.message || e));
      return;
    }
    const btn = $('btn-sensor-test-push');
    if (btn) btn.disabled = true;
    try {
      const r = await apiPost('/api/admin/sensors/test-push', payload);
      if (!r.ok) {
        pushSensorMsg('err', r.message || '测试推送失败');
        flash(r.message || '测试推送失败', false);
        return;
      }
      const d = r.data || {};
      pushSensorMsg(
        'ok',
        `推送成功 · ${d.receivedAt || ''} · ${formatStatusBrief(d.status)}`,
        `${formatEnvBrief(d.environment)}\n\n${JSON.stringify({ status: d.status, environment: d.environment }, null, 2)}`
      );
      flash('测试推送成功');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

/* —— 日志 —— */
function renderAudit() {
  const box = $('panel-audit');
  box.innerHTML = `
    <h2>操作日志</h2>
    <div class="toolbar">
      <label>操作人<input id="a-actor" placeholder="关键字" /></label>
      <label>动作
        <select id="a-action">
          <option value="">全部</option>
          <option value="login">login</option>
          <option value="logout">logout</option>
          <option value="register">register</option>
          <option value="user_create">user_create</option>
          <option value="user_update">user_update</option>
          <option value="user_delete">user_delete</option>
          <option value="user_reset_pwd">user_reset_pwd</option>
          <option value="threshold_save">threshold_save</option>
          <option value="dict_upsert">dict_upsert</option>
          <option value="map_config_save">map_config_save</option>
          <option value="sensor_config_save">sensor_config_save</option>
          <option value="sensor_config_sync">sensor_config_sync</option>
          <option value="reserves_save">reserves_save</option>
        </select>
      </label>
      <button type="button" class="btn" id="btn-a-filter">筛选</button>
      <button type="button" class="btn ghost" id="btn-a-export">导出 JSON</button>
      <button type="button" class="btn danger" id="btn-a-clear">清空日志</button>
    </div>
    <div class="table-wrap" id="audit-table"></div>`;

  const draw = () => {
    const rows = filterAuditLogs({
      actor: $('a-actor')?.value.trim(),
      action: $('a-action')?.value,
    });
    $('audit-table').innerHTML = `
      <table class="data">
        <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>结果</th><th>摘要</th></tr></thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (r) => `<tr>
                    <td>${fmtTime(r.at)}</td><td>${r.actor}</td><td>${r.action}</td>
                    <td>${r.target || ''}</td><td>${r.result}</td><td>${r.summary || ''}</td></tr>`
                  )
                  .join('')
              : '<tr><td colspan="6">无日志</td></tr>'
          }
        </tbody>
      </table>`;
  };
  draw();
  $('btn-a-filter')?.addEventListener('click', draw);
  $('btn-a-clear')?.addEventListener('click', () => {
    if (!confirm('清空全部操作日志？')) return;
    clearAuditLogs();
    flash('日志已清空');
    draw();
  });
  $('btn-a-export')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(listAuditLogs(), null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `audit-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

function renderPerms() {
  $('panel-perms').innerHTML = `
    <h2>权限说明</h2>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>能力</th><th>管理员</th><th>值班员</th></tr></thead>
        <tbody>
          <tr><td>查看一张图</td><td>是</td><td>是</td></tr>
          <tr><td>进入管理后台</td><td>是</td><td>否</td></tr>
          <tr><td>环境阈值改配</td><td>仅后台</td><td>否</td></tr>
          <tr><td>边坡消警</td><td>是</td><td>否</td></tr>
          <tr><td>储量参数改配</td><td>仅后台</td><td>否</td></tr>
          <tr><td>字典 / 地图源 / 用户管理</td><td>是</td><td>否</td></tr>
          <tr><td>数据接入（连接 / 站点 / 测试）</td><td>是</td><td>否</td></tr>
        </tbody>
      </table>
    </div>
    <p class="muted">权限由 Spring Security 承接；配置与业务数据均以数据库/接口为准。</p>`;
  }

async function boot() {
  if (!requireAdmin()) return;
  await initUserStore();
  initDictStore();
  $('admin-user').textContent = `${session.displayName || session.username} · 管理员`;

  fileMapConfig = {};
  fileSensorConfig = {};
  fileThresholds = null;
  fileReserves = {};

  // 先清储量本地缓存，避免旧 23/24 草稿在页面逻辑里再次写回库
  clearReservesLocalCache();

  if (!isStaticHosting()) {
    try {
      const mapRes = await apiGet('/api/admin/map');
      if (mapRes.ok && mapRes.data) fileMapConfig = mapRes.data;
    } catch {
      /* keep empty */
    }
    try {
      const sensorRes = await apiGet('/api/admin/sensors');
      if (sensorRes.ok && sensorRes.data) fileSensorConfig = sensorRes.data;
    } catch {
      /* keep empty */
    }
    try {
      const thRes = await apiGet('/api/admin/thresholds');
      if (thRes.ok && thRes.data) fileThresholds = thRes.data;
    } catch {
      /* keep empty */
    }
    try {
      const rvRes = await apiGet('/api/admin/reserves');
      if (rvRes.ok && rvRes.data) fileReserves = rvRes.data;
    } catch {
      /* keep empty */
    }
  }

  initEnvThresholds(fileThresholds || getDefaultEnvThresholds());
  initReserves(fileReserves || {});

  bindNav();
  showPanel('overview');
}

boot();
