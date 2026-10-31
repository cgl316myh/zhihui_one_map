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
let fileVideoPlatform = {};
let fileVideoCameras = [];
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
    `边坡云平台=${st.bdlx?.lastPullAt ? `上次 ${st.bdlx.lastPullAt}` : '未拉取'}${st.bdlx?.error ? ` (${st.bdlx.error})` : ''}`,
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
    'cad-layers': renderCadLayers,
    video: renderVideoAdmin,
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

/* —— CAD 矢量图层 —— */
let _cadLayersCfg = null;

async function loadCadLayersCfg() {
  if (isStaticHosting()) {
    return { version: 1, layers: [] };
  }
  const r = await apiGet('/api/admin/cad-layers');
  return r.ok && r.data ? r.data : { version: 1, layers: [] };
}

async function renderCadLayers() {
  const box = $('panel-cad-layers');
  if (!box) return;
  box.innerHTML = `<div class="thresh-page"><p class="muted">加载 CAD 图层配置…</p></div>`;
  try {
    _cadLayersCfg = await loadCadLayersCfg();
  } catch (e) {
    box.innerHTML = `<div class="thresh-page"><p class="muted">加载失败：${e.message || e}</p></div>`;
    return;
  }
  const layers = Array.isArray(_cadLayersCfg.layers) ? _cadLayersCfg.layers : [];
  box.innerHTML = `
    <div class="thresh-page">
      <div class="thresh-page-hd">
        <div>
          <h2>CAD 矢量图层</h2>
          <p class="muted">控制一张图是否允许加载各 CAD 层。关闭「允许加载」后，前端不显示也不请求该 GeoJSON。一期仅矿界点/线。</p>
        </div>
        <div class="thresh-page-actions">
          <button type="button" class="btn ghost" id="btn-cad-reload">重新加载</button>
          <button type="button" class="btn" id="btn-cad-save">保存</button>
        </div>
      </div>
      <section class="thresh-period-card is-active">
        <header class="thresh-period-hd">
          <div>
            <h3>图层清单</h3>
            <p>共 ${layers.length} 层 · GeoJSON 静态路径 /data/cad/</p>
          </div>
        </header>
        <div class="thresh-metric-list" id="cad-layer-list">
          ${
            layers.length
              ? layers
                  .map((l, idx) => {
                    const enabled = l.enabled !== false;
                    const defaultOn = Boolean(l.defaultOn);
                    return `
              <article class="thresh-metric map-source-row" data-idx="${idx}" data-id="${l.id || ''}">
                <div class="thresh-metric-name">
                  <strong>${l.name || l.id || '未命名'}</strong>
                  <span><code>${l.id || ''}</code> · ${l.geom || ''} · ${l.group || ''}</span>
                  <label class="map-enable">
                    <input type="checkbox" data-f="enabled" ${enabled ? 'checked' : ''} />
                    允许加载
                  </label>
                  <label class="map-enable">
                    <input type="checkbox" data-f="defaultOn" ${defaultOn ? 'checked' : ''} />
                    默认打开
                  </label>
                </div>
                <div class="thresh-metric-fields map-fields-grid">
                  <label class="thresh-field map-field-wide">
                    <span>GeoJSON 地址</span>
                    <div class="thresh-input-wrap">
                      <input data-f="url" value="${l.url || ''}" readonly />
                    </div>
                  </label>
                  <label class="thresh-field">
                    <span>线/点颜色</span>
                    <div class="thresh-input-wrap">
                      <input data-f="color" value="${(l.style && l.style.color) || '#e74c3c'}" />
                    </div>
                  </label>
                  <label class="thresh-field">
                    <span>线宽 / 半径</span>
                    <div class="thresh-input-wrap">
                      <input type="number" data-f="weight" value="${(l.style && (l.style.weight ?? l.style.radius)) || 3}" />
                    </div>
                  </label>
                </div>
              </article>`;
                  })
                  .join('')
              : '<p class="muted">暂无图层，请确认 seed/cfg_cad_layers.json 已导入数据库。</p>'
          }
        </div>
      </section>
      <p class="thresh-foot muted">保存后刷新一张图生效。大层（等高线等）本期不上图，后续在配置中追加即可。</p>
    </div>`;

  $('btn-cad-reload')?.addEventListener('click', () => renderCadLayers());
  $('btn-cad-save')?.addEventListener('click', async () => {
    const nextLayers = layers.map((l, idx) => {
      const row = box.querySelector(`.map-source-row[data-idx="${idx}"]`);
      if (!row) return l;
      const enabled = row.querySelector('[data-f="enabled"]')?.checked !== false;
      const defaultOn = Boolean(row.querySelector('[data-f="defaultOn"]')?.checked);
      const color = row.querySelector('[data-f="color"]')?.value?.trim() || '#e74c3c';
      const weight = Number(row.querySelector('[data-f="weight"]')?.value) || 3;
      const style = { ...(l.style || {}) };
      if ((l.geom || '') === 'point') {
        style.radius = weight;
        style.color = color;
        style.fillColor = color;
      } else {
        style.weight = weight;
        style.color = color;
      }
      return { ...l, enabled, defaultOn, style };
    });
    const body = { version: _cadLayersCfg.version || 1, layers: nextLayers };
    const r = await apiPut('/api/admin/cad-layers', body);
    if (!r.ok) {
      flash(r.message || '保存失败', false);
      return;
    }
    _cadLayersCfg = body;
    appendAuditLog({
      actor: session.username,
      action: 'cad_layers_save',
      result: 'ok',
      summary: `保存 CAD 图层 · ${nextLayers.filter((x) => x.enabled).length}/${nextLayers.length} 启用`,
    });
    flash('CAD 图层配置已保存');
    renderCadLayers();
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

async function loadBdlxCfg() {
  const r = await apiGet('/api/admin/sensors/bdlx');
  return r.ok ? r.data || {} : {};
}

async function loadFtEnvCfg() {
  const r = await apiGet('/api/admin/sensors/ftenv');
  return r.ok ? r.data || {} : {};
}

async function renderSensorConnect() {
  const cfg = await loadBridgeCfg();
  const [bdlx, ftenv] = await Promise.all([loadBdlxCfg(), loadFtEnvCfg()]);
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
          <p class="muted">边坡云平台登录信息、MQTT / HTTP / TCP。站点映射请到「站点与策略」。</p>
        </div>
        <div class="thresh-page-actions">
          <button type="button" class="btn" id="btn-bridge-save" ${staticDemo ? 'disabled' : ''}>保存连接</button>
        </div>
      </div>

      <section class="thresh-period-card is-active" style="margin-bottom:14px">
        <header class="thresh-period-hd">
          <div>
            <h3>边坡位移云平台（易尔 / BDLX）</h3>
            <p>登录网址、账号、密码；每小时拉取最新位移 / 雨量 / 预警</p>
          </div>
          <label class="map-enable" style="margin:0">
            <input type="checkbox" name="bdlx-enabled" ${bdlx.enabled !== false ? 'checked' : ''} /> 启用拉取
          </label>
        </header>
        <div class="thresh-metric-list">
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-fields map-fields-2">
              ${field('登录网址', `<input name="bdlx-web" value="${escapeHtml(bdlx.webUrl || 'http://bdlx.jgtop1.com/')}" />`)}
              ${field('接口基址', `<input name="bdlx-api" value="${escapeHtml(bdlx.apiBase || 'http://wtapi.jgtop1.com')}" />`)}
            </div>
          </article>
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-fields map-fields-2">
              ${field('登录用户名', `<input name="bdlx-user" value="${escapeHtml(bdlx.username || '')}" autocomplete="off" />`)}
              ${field('登录密码', `<input type="text" name="bdlx-pass" value="${escapeHtml(bdlx.password || '')}" autocomplete="off" />`)}
            </div>
          </article>
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-fields map-fields-2">
              ${field('Cron', `<input name="bdlx-cron" value="${escapeHtml(bdlx.cron || '0 8 * * * *')}" />`)}
              ${field('回看小时', `<input type="number" min="24" name="bdlx-lookback" value="${bdlx.lookbackHours ?? 744}" /><i>默认 744=近一个月，去重写入时序</i>`)}
            </div>
          </article>
          <article class="thresh-metric map-global-row" id="bdlx-captcha-row">
            <div class="thresh-metric-name"><strong>算术验证码</strong><span>填计算结果，不是算式本身</span></div>
            <div class="thresh-metric-fields" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">
              <img id="bdlx-captcha-img" alt="验证码" style="height:36px;background:#fff;border-radius:4px;display:none" />
              <input id="bdlx-captcha-code" placeholder="如 48 或 -1" style="width:88px" autocomplete="off" />
              <input type="hidden" id="bdlx-captcha-uuid" />
              <button type="button" class="btn ghost" id="btn-bdlx-captcha" ${staticDemo ? 'disabled' : ''}>刷新验证码</button>
              <button type="button" class="btn ghost" id="btn-bdlx-login-pull" ${staticDemo ? 'disabled' : ''}>登录并拉取</button>
            </div>
          </article>
          <p class="muted" style="padding:0 12px 8px">
            上次成功：${escapeHtml(bdlx.lastSuccessAt || '尚未拉取')}
            ${bdlx.lastError ? ` · 错误：${escapeHtml(String(bdlx.lastError))}` : ''}
            · Token 仅内存${bdlx.tokenConfigured ? '（已配置环境变量）' : ''}
            <button type="button" class="btn ghost" id="btn-bdlx-save" style="margin-left:8px" ${staticDemo ? 'disabled' : ''}>保存云平台账号</button>
            <button type="button" class="btn ghost" id="btn-bdlx-pull" ${staticDemo ? 'disabled' : ''}>立即拉取</button>
          </p>
        </div>
      </section>

      <section class="thresh-period-card is-active" style="margin-bottom:14px">
        <header class="thresh-period-hd">
          <div>
            <h3>环境数据云平台（ThingsBoard）</h3>
            <p>登录网址、账号、密码；每小时拉取温湿度 / 噪声 / PM / 气压 / 风速风向</p>
          </div>
          <label class="map-enable" style="margin:0">
            <input type="checkbox" name="ftenv-enabled" ${ftenv.enabled !== false ? 'checked' : ''} /> 启用拉取
          </label>
        </header>
        <div class="thresh-metric-list">
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-fields map-fields-2">
              ${field('登录网址', `<input name="ftenv-web" value="${escapeHtml(ftenv.webUrl || 'http://182.40.193.119:9010/#/logon')}" />`)}
              ${field('接口基址', `<input name="ftenv-api" value="${escapeHtml(ftenv.apiBase || 'http://182.40.193.119:8081')}" />`)}
            </div>
          </article>
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-fields map-fields-2">
              ${field('登录用户名', `<input name="ftenv-user" value="${escapeHtml(ftenv.username || '')}" autocomplete="off" />`)}
              ${field('登录密码', `<input type="text" name="ftenv-pass" value="${escapeHtml(ftenv.password || '')}" autocomplete="off" />`)}
            </div>
          </article>
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-fields map-fields-2">
              ${field('Cron', `<input name="ftenv-cron" value="${escapeHtml(ftenv.cron || '0 18 * * * *')}" />`)}
              ${field('回看小时', `<input type="number" min="2" name="ftenv-lookback" value="${ftenv.lookbackHours ?? 168}" /><i>首次按小时均值回填时序，之后从上次成功起增量</i>`)}
            </div>
          </article>
          <p class="muted" style="padding:0 12px 8px">
            上次成功：${escapeHtml(ftenv.lastSuccessAt || '尚未拉取')}
            ${ftenv.lastError ? ` · 错误：${escapeHtml(String(ftenv.lastError))}` : ''}
            · Token 仅内存
            <button type="button" class="btn ghost" id="btn-ftenv-save" style="margin-left:8px" ${staticDemo ? 'disabled' : ''}>保存云平台账号</button>
            <button type="button" class="btn ghost" id="btn-ftenv-pull" ${staticDemo ? 'disabled' : ''}>立即拉取</button>
          </p>
        </div>
      </section>

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
              ${field('publicBaseUrl', `<input name="http-public" value="${escapeHtml(cfg.http?.publicBaseUrl || '')}" placeholder="https://x.x.x.x:8082" />`)}
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
  $('btn-bdlx-save')?.addEventListener('click', async () => {
    if (isStaticHosting()) {
      flash('未连接后端', false);
      return;
    }
    const r = await apiPut('/api/admin/sensors/bdlx', {
      enabled: Boolean(box.querySelector('[name="bdlx-enabled"]')?.checked),
      webUrl: box.querySelector('[name="bdlx-web"]')?.value || '',
      apiBase: box.querySelector('[name="bdlx-api"]')?.value || '',
      username: box.querySelector('[name="bdlx-user"]')?.value || '',
      password: box.querySelector('[name="bdlx-pass"]')?.value || '',
      cron: box.querySelector('[name="bdlx-cron"]')?.value || '',
      lookbackHours: Number(box.querySelector('[name="bdlx-lookback"]')?.value || 744),
    });
    if (!r.ok) {
      flash(r.message || '云平台配置保存失败', false);
      return;
    }
    flash('边坡云平台账号已保存');
    renderSensorConnect();
  });
  $('btn-ftenv-save')?.addEventListener('click', async () => {
    if (isStaticHosting()) {
      flash('未连接后端', false);
      return;
    }
    const r = await apiPut('/api/admin/sensors/ftenv', {
      enabled: Boolean(box.querySelector('[name="ftenv-enabled"]')?.checked),
      webUrl: box.querySelector('[name="ftenv-web"]')?.value || '',
      apiBase: box.querySelector('[name="ftenv-api"]')?.value || '',
      username: box.querySelector('[name="ftenv-user"]')?.value || '',
      password: box.querySelector('[name="ftenv-pass"]')?.value || '',
      cron: box.querySelector('[name="ftenv-cron"]')?.value || '',
      lookbackHours: Number(box.querySelector('[name="ftenv-lookback"]')?.value || 168),
    });
    if (!r.ok) {
      flash(r.message || '环境云配置保存失败', false);
      return;
    }
    flash('环境云平台账号已保存');
    renderSensorConnect();
  });
  $('btn-ftenv-pull')?.addEventListener('click', async () => {
    const r = await apiPost('/api/admin/sensors/ftenv-pull-now', {});
    if (!r.ok) {
      flash(r.message || '拉取失败', false);
      return;
    }
    flash(`已拉取 站 ${r.data?.points ?? 0} / 时序 ${r.data?.samples ?? 0}`);
    renderSensorConnect();
  });
  $('btn-bdlx-pull')?.addEventListener('click', async () => {
    const r = await apiPost('/api/admin/sensors/bdlx-pull-now', {});
    if (showBdlxCaptcha(r)) {
      flash(r.message || '请填写验证码计算结果后再点「登录并拉取」', false);
      return;
    }
    if (!r.ok) {
      flash(r.message || '拉取失败', false);
      return;
    }
    flash(`已拉取 点 ${r.data?.points ?? 0} / 告警 ${r.data?.alarms ?? 0}`);
    renderSensorConnect();
  });
  $('btn-bdlx-captcha')?.addEventListener('click', async () => {
    const r = await apiGet('/api/admin/sensors/bdlx-captcha');
    if (!r.ok) {
      flash(r.message || '获取验证码失败', false);
      return;
    }
    showBdlxCaptcha(r);
  });
  $('btn-bdlx-login-pull')?.addEventListener('click', async () => {
    const uuid = $('bdlx-captcha-uuid')?.value || '';
    const code = ($('bdlx-captcha-code')?.value || '').trim();
    if (!uuid || !code) {
      flash('请先刷新验证码并填写计算结果', false);
      return;
    }
    const r = await apiPost('/api/admin/sensors/bdlx-login-pull', { uuid, code });
    if (showBdlxCaptcha(r)) {
      flash(r.message || '验证码不正确，已刷新请重填', false);
      const cap = await apiGet('/api/admin/sensors/bdlx-captcha');
      if (cap.ok) showBdlxCaptcha(cap);
      return;
    }
    if (!r.ok) {
      flash(r.message || '登录/拉取失败', false);
      const cap = await apiGet('/api/admin/sensors/bdlx-captcha');
      if (cap.ok) showBdlxCaptcha(cap);
      return;
    }
    flash(`已拉取 点 ${r.data?.points ?? 0} / 告警 ${r.data?.alarms ?? 0}`);
    renderSensorConnect();
  });
}

function showBdlxCaptcha(r) {
  const img = r?.data?.img;
  const uuid = r?.data?.uuid;
  if (!img || !uuid) return false;
  const el = $('bdlx-captcha-img');
  const hid = $('bdlx-captcha-uuid');
  const inp = $('bdlx-captcha-code');
  if (el) {
    el.src = img;
    el.style.display = 'block';
  }
  if (hid) hid.value = uuid;
  if (inp) {
    inp.value = '';
    inp.focus();
  }
  return Boolean(r?.data?.needCaptcha) || r?.code === 409;
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

function parseCamExtra(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function readVideoPlatformForm() {
  const provider = $('vp-provider')?.value || 'ezviz';
  return {
    enabled: Boolean($('vp-enabled')?.checked),
    provider,
    ezviz: {
      appKey: $('vp-app-key')?.value?.trim() || '',
      appSecret: $('vp-app-secret')?.value?.trim() || '',
      domain: $('vp-domain')?.value?.trim() || 'https://open.ys7.com',
      playerTemplate: $('vp-template')?.value || 'simple',
      staticPath: $('vp-static-path')?.value?.trim() || '',
    },
    hls: {
      fallbackUrl: $('vp-hls-url')?.value?.trim() || '',
    },
    zlm: {
      baseUrl: $('vp-zlm-base')?.value?.trim() || '',
      secret: $('vp-zlm-secret')?.value?.trim() || '',
    },
  };
}

function readVideoCamerasForm() {
  const rows = document.querySelectorAll('#video-cam-body tr[data-cam-row]');
  return Array.from(rows).map((tr, idx) => {
    const extra = {
      deviceSerial: (tr.querySelector('[data-f="deviceSerial"]')?.value || '').trim().toUpperCase(),
      channelNo: Number(tr.querySelector('[data-f="channelNo"]')?.value || 1),
      streamType: tr.querySelector('[data-f="streamType"]')?.value || 'sub',
      enabled: tr.querySelector('[data-f="enabled"]')?.checked !== false,
      hlsUrl: (tr.querySelector('[data-f="hlsUrl"]')?.value || '').trim(),
      zlmStream: (tr.querySelector('[data-f="zlmStream"]')?.value || '').trim(),
      provider: (tr.querySelector('[data-f="provider"]')?.value || '').trim(),
    };
    return {
      id: (tr.querySelector('[data-f="id"]')?.value || '').trim(),
      name: (tr.querySelector('[data-f="name"]')?.value || '').trim(),
      lng: tr.querySelector('[data-f="lng"]')?.value ? Number(tr.querySelector('[data-f="lng"]').value) : null,
      lat: tr.querySelector('[data-f="lat"]')?.value ? Number(tr.querySelector('[data-f="lat"]').value) : null,
      scene: (tr.querySelector('[data-f="scene"]')?.value || '').trim(),
      online: Boolean(tr.querySelector('[data-f="online"]')?.checked),
      sortNo: idx + 1,
      extra,
    };
  }).filter((c) => c.id);
}

function cameraRowHtml(cam, idx) {
  const ex = parseCamExtra(cam.extra);
  return `<tr data-cam-row>
    <td><input data-f="id" value="${escapeHtml(cam.id || '')}" placeholder="CAM-01" /></td>
    <td><input data-f="name" value="${escapeHtml(cam.name || '')}" /></td>
    <td><input data-f="lng" type="number" step="0.00001" value="${cam.lng ?? ''}" style="width:6.5rem" /></td>
    <td><input data-f="lat" type="number" step="0.00001" value="${cam.lat ?? ''}" style="width:6.5rem" /></td>
    <td><input data-f="scene" value="${escapeHtml(cam.scene || '')}" /></td>
    <td><input data-f="deviceSerial" value="${escapeHtml(ex.deviceSerial || '')}" placeholder="C12345678" /></td>
    <td><input data-f="channelNo" type="number" min="1" value="${ex.channelNo ?? 1}" style="width:3.5rem" /></td>
    <td><select data-f="streamType"><option value="sub" ${ex.streamType !== 'main' ? 'selected' : ''}>子码流</option><option value="main" ${ex.streamType === 'main' ? 'selected' : ''}>主码流</option></select></td>
    <td><input data-f="hlsUrl" value="${escapeHtml(ex.hlsUrl || '')}" placeholder="HLS 模式填 m3u8" style="min-width:8rem" /></td>
    <td><input data-f="zlmStream" value="${escapeHtml(ex.zlmStream || '')}" placeholder="ZLM 流名" style="width:5.5rem" /></td>
    <td><label><input data-f="online" type="checkbox" ${cam.online ? 'checked' : ''} />在线</label></td>
    <td><label><input data-f="enabled" type="checkbox" ${ex.enabled !== false ? 'checked' : ''} />启用</label></td>
    <td><button type="button" class="btn ghost btn-del-cam">删</button></td>
  </tr>`;
}

function renderVideoAdmin() {
  const cfg = fileVideoPlatform || {};
  const ez = cfg.ezviz || {};
  const hls = cfg.hls || {};
  const zlm = cfg.zlm || {};
  const cams = fileVideoCameras?.length ? fileVideoCameras : [];
  const box = $('panel-video');
  box.innerHTML = `
    <h2>视频监控</h2>
    <p class="muted">平台参数写入 <code>cfg_video_platform</code>；摄像头列表写入 <code>biz_video_camera</code>。AppSecret 仅存数据库，大屏通过 <code>/api/video</code> 获取短时 Token，不下发密钥。</p>

    <div class="card-block">
      <header class="thresh-period-hd"><div><h3>平台接入</h3><p>海康/萤石云、HLS、ZLMediaKit 等全局参数</p></div></header>
      <div class="form-grid" style="display:grid;grid-template-columns:140px 1fr;gap:8px 12px;max-width:720px">
        <label><input id="vp-enabled" type="checkbox" ${cfg.enabled ? 'checked' : ''} /> 启用视频接入</label><span></span>
        <label for="vp-provider">接入方式</label>
        <select id="vp-provider">
          <option value="ezviz" ${cfg.provider === 'ezviz' ? 'selected' : ''}>萤石云 EZOPEN（海康 IPC/NVR 上云）</option>
          <option value="hls" ${cfg.provider === 'hls' ? 'selected' : ''}>HLS 直链（流媒体服务器输出）</option>
          <option value="zlm" ${cfg.provider === 'zlm' ? 'selected' : ''}>ZLMediaKit（按流名拼 HLS）</option>
        </select>
        <label for="vp-app-key">AppKey</label>
        <input id="vp-app-key" value="${escapeHtml(ez.appKey || '')}" placeholder="萤石开放平台应用 AppKey" />
        <label for="vp-app-secret">AppSecret</label>
        <input id="vp-app-secret" type="password" value="${escapeHtml(ez.appSecret || '')}" placeholder="${ez.appSecretSet ? '已保存，留空不改' : '应用密钥'}" autocomplete="new-password" />
        <label for="vp-domain">开放平台域名</label>
        <input id="vp-domain" value="${escapeHtml(ez.domain || 'https://open.ys7.com')}" />
        <label for="vp-template">播放器模板</label>
        <select id="vp-template">
          <option value="simple" ${ez.playerTemplate === 'simple' ? 'selected' : ''}>simple 极简</option>
          <option value="pcLive" ${ez.playerTemplate === 'pcLive' ? 'selected' : ''}>pcLive 预览栏</option>
        </select>
        <label for="vp-static-path">SDK 静态资源路径</label>
        <input id="vp-static-path" value="${escapeHtml(ez.staticPath || '')}" placeholder="可选，默认走萤石 CDN" />
        <label for="vp-hls-url">HLS 演示/回退地址</label>
        <input id="vp-hls-url" value="${escapeHtml(hls.fallbackUrl || '')}" placeholder="provider=hls 时默认播放地址" />
        <label for="vp-zlm-base">ZLM 服务地址</label>
        <input id="vp-zlm-base" value="${escapeHtml(zlm.baseUrl || '')}" placeholder="http://192.168.1.100:8080" />
        <label for="vp-zlm-secret">ZLM API 密钥</label>
        <input id="vp-zlm-secret" type="password" value="${escapeHtml(zlm.secret || '')}" placeholder="${zlm.secretSet ? '已保存' : '可选'}" />
      </div>
      <div class="controls" style="margin-top:12px">
        <button type="button" class="btn" id="btn-video-platform-save">保存平台配置</button>
        <button type="button" class="btn ghost" id="btn-video-test-token">测试萤石 Token</button>
      </div>
    </div>

    <div class="card-block" style="margin-top:16px">
      <header class="thresh-period-hd">
        <div><h3>摄像头点位</h3><p>萤石填序列号+通道；HLS 填 m3u8；ZLM 填流名（如 cam-gate）。详见 <a href="./docs/视频监控接入配置指南.html" target="_blank">配置指南</a></p></div>
        <button type="button" class="btn ghost" id="btn-video-cam-add">添加摄像头</button>
      </header>
      <div class="table-wrap">
        <table class="data video-cam-table">
          <thead><tr>
            <th>ID</th><th>名称</th><th>经度</th><th>纬度</th><th>场景</th>
            <th>序列号</th><th>通道</th><th>码流</th><th>HLS 地址</th><th>ZLM 流名</th><th>状态</th><th>启用</th><th></th>
          </tr></thead>
          <tbody id="video-cam-body">${cams.map(cameraRowHtml).join('')}</tbody>
        </table>
      </div>
      <div class="controls" style="margin-top:12px">
        <button type="button" class="btn" id="btn-video-cams-save">保存摄像头列表</button>
      </div>
      <p class="thresh-foot muted">大屏读取 <code>GET /api/video</code>：返回 <code>player.accessToken</code>（萤石）与各点位 <code>playUrl</code> / <code>hlsUrl</code>。</p>
    </div>`;

  $('btn-video-platform-save')?.addEventListener('click', async () => {
    const body = readVideoPlatformForm();
    const r = await apiPut('/api/admin/video/platform', body);
    if (r.ok) {
      fileVideoPlatform = r.data;
      flash('平台配置已保存', true);
      renderVideoAdmin();
    } else {
      flash(r.message || '保存失败', false);
    }
  });

  $('btn-video-test-token')?.addEventListener('click', async () => {
    const r = await apiPost('/api/admin/video/test-token', {});
    if (r.ok) {
      flash(`Token 正常：${r.data.accessTokenPreview || 'ok'}`, true);
    } else {
      flash(r.message || 'Token 测试失败', false);
    }
  });

  $('btn-video-cams-save')?.addEventListener('click', async () => {
    const cameras = readVideoCamerasForm();
    const r = await apiPut('/api/admin/video/cameras', { cameras });
    if (r.ok) {
      fileVideoCameras = r.data;
      flash(`已保存 ${cameras.length} 路摄像头`, true);
      renderVideoAdmin();
    } else {
      flash(r.message || '保存失败', false);
    }
  });

  $('btn-video-cam-add')?.addEventListener('click', () => {
    const tbody = $('video-cam-body');
    const n = tbody.querySelectorAll('tr').length + 1;
    tbody.insertAdjacentHTML('beforeend', cameraRowHtml({
      id: `CAM-${String(n).padStart(2, '0')}`,
      name: `${n}# 新点位`,
      online: false,
      extra: { channelNo: 1, streamType: 'sub', enabled: true },
    }, n));
    bindVideoCamRowDeletes();
  });

  bindVideoCamRowDeletes();
}

function bindVideoCamRowDeletes() {
  document.querySelectorAll('.btn-del-cam').forEach((btn) => {
    btn.onclick = () => btn.closest('tr')?.remove();
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
          <tr><td>CAD 矢量图层开关</td><td>是</td><td>否</td></tr>
          <tr><td>视频监控（平台 / 摄像头）</td><td>是</td><td>否</td></tr>
          <tr><td>数据接入（连接 / 站点 / 测试）</td><td>是</td><td>否</td></tr>
        </tbody>
      </table>
    </div>
    <p class="muted">权限由 Spring Security 承接；配置与业务数据均以数据库/接口为准。</p>`;
  }

function formatAppVersion(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  return v.startsWith('v') || v.startsWith('V') ? v : `v${v}`;
}

async function fillAppVersion() {
  const el = $('app-version');
  if (!el) return;
  try {
    const r = await apiGet('/api/version');
    const v = formatAppVersion(r?.data?.version);
    if (v) el.textContent = v;
  } catch {
    /* keep HTML fallback */
  }
}

async function boot() {
  if (!requireAdmin()) return;
  await initUserStore();
  initDictStore();
  $('admin-user').textContent = `${session.displayName || session.username} · 管理员`;
  fillAppVersion();

  fileMapConfig = {};
  fileSensorConfig = {};
  fileThresholds = null;
  fileReserves = {};

  fileVideoPlatform = {};
  fileVideoCameras = [];

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
    try {
      const vpRes = await apiGet('/api/admin/video/platform');
      if (vpRes.ok && vpRes.data) fileVideoPlatform = vpRes.data;
    } catch {
      /* keep empty */
    }
    try {
      const vcRes = await apiGet('/api/admin/video/cameras');
      if (vcRes.ok && Array.isArray(vcRes.data)) fileVideoCameras = vcRes.data;
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
