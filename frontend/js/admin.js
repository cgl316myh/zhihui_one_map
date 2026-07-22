import {
  initUserStore,
  listUsers,
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
import {
  initEnvThresholds,
  getEnvThresholds,
  getDefaultEnvThresholds,
  saveEnvThresholds,
  resetEnvThresholds,
  getActivePeriodKey,
} from './modules/envThresholds.js';

let session = null;
let fileMapConfig = {};
let fileSensorConfig = {};
let fileThresholds = null;
let selectedDictType = 'point_status';
let sensorDraft = null;

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
    dict: renderDict,
    maps: renderMaps,
    sensors: renderSensors,
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

/* —— 概览 —— */
function renderOverview() {
  const users = listUsers();
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
function renderUsers() {
  const box = $('panel-users');
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
    let rows = listUsers();
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
    if (!confirm('恢复预置 admin/user 账号？当前用户库将被覆盖。')) return;
    await resetUsersToSeed();
    appendAuditLog({
      actor: session.username,
      action: 'user_reset_seed',
      result: 'ok',
      summary: '恢复预置用户',
    });
    flash('已恢复预置用户');
    draw();
    renderOverview();
  });
  $('user-table')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const tr = e.target.closest('tr[data-id]');
    if (!btn || !tr) return;
    const id = tr.dataset.id;
    const user = listUsers().find((u) => u.id === id);
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
      const r = adminDeleteUser(id, session.username);
      appendAuditLog({
        actor: session.username,
        action: 'user_delete',
        target: user.username,
        result: r.ok ? 'ok' : 'fail',
        summary: r.ok ? '删除用户' : r.message,
      });
      flash(r.ok ? '已删除' : r.message, r.ok);
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
      r = adminUpdateUser(user.id, payload, session.username);
      appendAuditLog({
        actor: session.username,
        action: 'user_update',
        target: user.username,
        result: r.ok ? 'ok' : 'fail',
        summary: r.ok ? '编辑用户' : r.message,
      });
    }
    flash(r.ok ? '已保存' : r.message, r.ok);
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

/* —— 数据接入 MQTT / HTTP·TCP —— */
function field(label, html) {
  return `<label class="thresh-field"><span>${label}</span><div class="thresh-input-wrap">${html}</div></label>`;
}

function collectSensorForm(box) {
  const g = (name) => box.querySelector(`[name="${name}"]`);
  const num = (name, fallback) => {
    const n = Number(g(name)?.value);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    frontend: {
      apiBaseUrl: (g('fe-base')?.value || '').trim(),
      pollIntervalMs: Math.max(30000, num('fe-poll', 30000)),
    },
    http: {
      enabled: g('http-enabled')?.checked !== false,
      host: (g('http-host')?.value || '').trim() || '0.0.0.0',
      port: num('http-port', 5173),
      pushPath: (g('http-path')?.value || '').trim() || '/api/push',
      staticDir: (g('http-static')?.value || '').trim() || '../frontend',
    },
    tcp: {
      enabled: Boolean(g('tcp-enabled')?.checked),
      host: (g('tcp-host')?.value || '').trim() || '0.0.0.0',
      port: num('tcp-port', 9000),
      frameHint: (g('tcp-hint')?.value || '').trim(),
    },
    mqtt: {
      enabled: g('mqtt-enabled')?.checked !== false,
      host: (g('mqtt-host')?.value || '').trim(),
      port: num('mqtt-port', 1883),
      username: (g('mqtt-user')?.value || '').trim(),
      password: g('mqtt-pass')?.value || '',
      clientId: (g('mqtt-client')?.value || '').trim() || 'mine-onemap-bridge',
      topic: (g('mqtt-topic')?.value || '').trim() || '#',
      keepalive: Math.max(30, num('mqtt-keep', 60)),
      reconnectDelaySec: Math.max(30, num('mqtt-reconn', 30)),
    },
    pollHintSec: Math.max(30, num('poll-hint', 30)),
  };
}

function renderSensors() {
  const cfg = sensorDraft || mergeSensorConfig(fileSensorConfig);
  sensorDraft = null;
  const mqttOn = cfg.mqtt?.enabled !== false;
  const httpOn = cfg.http?.enabled !== false;
  const tcpOn = Boolean(cfg.tcp?.enabled);
  const box = $('panel-sensors');
  box.innerHTML = `
    <div class="thresh-page">
      <div class="thresh-page-hd">
        <div>
          <h2>数据接入配置</h2>
          <p class="muted">统一管理传感器 MQTT 与 HTTP / TCP 推送地址及参数。本地保存后可导出或同步到网关 config.json。</p>
        </div>
        <div class="thresh-page-actions">
          <button type="button" class="btn ghost" id="btn-sensor-reset">清除本地覆盖</button>
          <button type="button" class="btn ghost" id="btn-sensor-export">导出 JSON</button>
          <button type="button" class="btn ghost" id="btn-sensor-sync">同步到网关</button>
          <button type="button" class="btn" id="btn-sensor-save">保存配置</button>
        </div>
      </div>

      <div class="thresh-compare">
        <section class="thresh-period-card ${mqttOn ? 'is-active' : ''}">
          <header class="thresh-period-hd">
            <div>
              <h3>传感器 MQTT 接入</h3>
              <p>对应说明：传感器 mqtt 数据接入</p>
            </div>
            <label class="map-enable" style="margin:0">
              <input type="checkbox" name="mqtt-enabled" ${mqttOn ? 'checked' : ''} />
              启用
            </label>
          </header>
          <div class="thresh-metric-list">
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-name">
                <strong>Broker</strong>
                <span>主机与端口</span>
              </div>
              <div class="thresh-metric-fields map-fields-2">
                ${field('主机', `<input name="mqtt-host" value="${cfg.mqtt?.host || ''}" placeholder="如 47.97.123.197" />`)}
                ${field('端口', `<input type="number" name="mqtt-port" value="${cfg.mqtt?.port ?? 1883}" /><i>TCP</i>`)}
              </div>
            </article>
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-name">
                <strong>鉴权</strong>
                <span>用户名 / 密码</span>
              </div>
              <div class="thresh-metric-fields map-fields-2">
                ${field('用户名', `<input name="mqtt-user" value="${cfg.mqtt?.username || ''}" autocomplete="off" />`)}
                ${field(
                  '密码',
                  `<input type="password" name="mqtt-pass" id="mqtt-pass" value="${cfg.mqtt?.password || ''}" autocomplete="new-password" /><button type="button" class="thresh-affix-btn" id="btn-mqtt-pass">显示</button>`
                )}
              </div>
            </article>
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-name">
                <strong>订阅</strong>
                <span>ClientId · Topic</span>
              </div>
              <div class="thresh-metric-fields map-fields-2">
                ${field('ClientId', `<input name="mqtt-client" value="${cfg.mqtt?.clientId || ''}" />`)}
                ${field('Topic', `<input name="mqtt-topic" value="${cfg.mqtt?.topic || '#'}" />`)}
              </div>
            </article>
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-name">
                <strong>心跳 / 重连</strong>
                <span>勿低于 30 秒</span>
              </div>
              <div class="thresh-metric-fields map-fields-2">
                ${field('Keepalive', `<input type="number" name="mqtt-keep" value="${cfg.mqtt?.keepalive ?? 60}" /><i>秒</i>`)}
                ${field('重连间隔', `<input type="number" name="mqtt-reconn" value="${cfg.mqtt?.reconnectDelaySec ?? 30}" /><i>秒</i>`)}
              </div>
            </article>
          </div>
        </section>

        <section class="thresh-period-card ${httpOn || tcpOn ? 'is-active' : ''}">
          <header class="thresh-period-hd">
            <div>
              <h3>HTTP / TCP 推送接口</h3>
              <p>对应说明：HTTP 或者 TCP 数据推送接口</p>
            </div>
          </header>
          <div class="thresh-metric-list">
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-name">
                <strong>HTTP 接收</strong>
                <span>平台 POST JSON 到本机</span>
                <label class="map-enable">
                  <input type="checkbox" name="http-enabled" ${httpOn ? 'checked' : ''} />
                  启用 HTTP
                </label>
              </div>
              <div class="thresh-metric-fields map-fields-grid">
                ${field('监听地址', `<input name="http-host" value="${cfg.http?.host || '0.0.0.0'}" />`)}
                ${field('端口', `<input type="number" name="http-port" value="${cfg.http?.port ?? 5173}" /><i>HTTP</i>`)}
                ${field('推送路径', `<input name="http-path" value="${cfg.http?.pushPath || '/api/push'}" />`)}
                <label class="thresh-field map-field-wide">
                  <span>静态目录 staticDir</span>
                  <div class="thresh-input-wrap">
                    <input name="http-static" value="${cfg.http?.staticDir || '../frontend'}" />
                  </div>
                </label>
              </div>
            </article>
            <article class="thresh-metric map-global-row">
              <div class="thresh-metric-name">
                <strong>TCP 接收（预留）</strong>
                <span>演示可配置；网关可按需扩展监听</span>
                <label class="map-enable">
                  <input type="checkbox" name="tcp-enabled" ${tcpOn ? 'checked' : ''} />
                  启用 TCP
                </label>
              </div>
              <div class="thresh-metric-fields map-fields-grid">
                ${field('监听地址', `<input name="tcp-host" value="${cfg.tcp?.host || '0.0.0.0'}" />`)}
                ${field('端口', `<input type="number" name="tcp-port" value="${cfg.tcp?.port ?? 9000}" /><i>TCP</i>`)}
                <label class="thresh-field map-field-wide">
                  <span>帧格式说明</span>
                  <div class="thresh-input-wrap">
                    <input name="tcp-hint" value="${cfg.tcp?.frameHint || ''}" placeholder="如 JSON 行" />
                  </div>
                </label>
              </div>
            </article>
          </div>
        </section>
      </div>

      <section class="thresh-period-card" style="margin-top:14px">
        <header class="thresh-period-hd">
          <div>
            <h3>前端读取网关</h3>
            <p>大屏 /api 基址与轮询间隔（≥ 30s）</p>
          </div>
        </header>
        <div class="thresh-metric-list">
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-name">
              <strong>API 基址</strong>
              <span>同域代理可留空</span>
            </div>
            <div class="thresh-metric-fields map-fields-2">
              ${field('apiBaseUrl', `<input name="fe-base" value="${cfg.frontend?.apiBaseUrl || ''}" placeholder="如 http://127.0.0.1:5173" />`)}
              ${field('轮询间隔', `<input type="number" name="fe-poll" value="${cfg.frontend?.pollIntervalMs ?? 30000}" /><i>ms</i>`)}
            </div>
          </article>
          <article class="thresh-metric map-global-row">
            <div class="thresh-metric-name">
              <strong>网关提示</strong>
              <span>pollHintSec</span>
            </div>
            <div class="thresh-metric-fields map-fields-1">
              ${field('建议轮询秒数', `<input type="number" name="poll-hint" value="${cfg.pollHintSec ?? 30}" /><i>秒</i>`)}
            </div>
          </article>
        </div>
      </section>

      <p class="thresh-foot muted">
        推送示例：<code>POST http://&lt;host&gt;:&lt;port&gt;&lt;pushPath&gt;</code> ·
        MQTT keepalive / 重连 / 前端轮询均强制 ≥ 30 秒。同步网关后建议重启 <code>gateway.py</code>。
      </p>
    </div>`;

  $('btn-mqtt-pass')?.addEventListener('click', () => {
    const input = $('mqtt-pass');
    const btn = $('btn-mqtt-pass');
    if (!input || !btn) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '隐藏' : '显示';
  });

  const persistLocal = () => {
    const next = collectSensorForm(box);
    saveSensorConfigOverride(next);
    appendAuditLog({
      actor: session.username,
      action: 'sensor_config_save',
      result: 'ok',
      summary: `保存数据接入 · MQTT ${next.mqtt.host}:${next.mqtt.port}`,
    });
    return next;
  };

  $('btn-sensor-save')?.addEventListener('click', () => {
    persistLocal();
    flash('数据接入配置已保存到本地');
    renderSensors();
  });
  $('btn-sensor-reset')?.addEventListener('click', () => {
    clearSensorConfigOverride();
    appendAuditLog({
      actor: session.username,
      action: 'sensor_config_reset',
      result: 'ok',
      summary: '清除数据接入本地覆盖',
    });
    flash('已清除本地覆盖');
    renderSensors();
  });
  $('btn-sensor-export')?.addEventListener('click', () => {
    const next = collectSensorForm(box);
    downloadSensorConfigJson(next, 'sensor-bridge-config.json');
    appendAuditLog({
      actor: session.username,
      action: 'sensor_config_export',
      result: 'ok',
      summary: '导出数据接入 JSON',
    });
    flash('已导出 JSON，可覆盖 sensor_bridge/config.json 对应字段');
  });
  $('btn-sensor-sync')?.addEventListener('click', async () => {
    const next = persistLocal();
    const base =
      next.frontend.apiBaseUrl ||
      `http://127.0.0.1:${next.http.port || 5173}`;
    flash('正在同步到网关…');
    const r = await syncSensorConfigToGateway(next, base);
    appendAuditLog({
      actor: session.username,
      action: 'sensor_config_sync',
      result: r.ok ? 'ok' : 'fail',
      summary: r.message,
    });
    flash(r.message, r.ok);
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
          <tr><td>储量日采出录入</td><td>是</td><td>否</td></tr>
          <tr><td>字典 / 地图源 / 用户管理</td><td>是</td><td>否</td></tr>
          <tr><td>数据接入（MQTT / HTTP·TCP）</td><td>是</td><td>否</td></tr>
        </tbody>
      </table>
    </div>
    <p class="muted">正式环境权限由 Spring Security 承接；当前为演示本地会话。</p>`;
}

async function boot() {
  if (!requireAdmin()) return;
  await initUserStore();
  initDictStore();
  $('admin-user').textContent = `${session.displayName || session.username} · 管理员`;

  try {
    const res = await fetch(`./data/map-config.json?_=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) fileMapConfig = await res.json();
  } catch {
    fileMapConfig = {};
  }
  try {
    const res = await fetch(`./data/sensor-bridge-config.json?_=${Date.now()}`, {
      cache: 'no-store',
    });
    if (res.ok) fileSensorConfig = await res.json();
  } catch {
    fileSensorConfig = {};
  }
  try {
    const res = await fetch(`./data/env-thresholds.json?_=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      fileThresholds = await res.json();
      initEnvThresholds(fileThresholds);
    } else {
      initEnvThresholds(getDefaultEnvThresholds());
    }
  } catch {
    initEnvThresholds(getDefaultEnvThresholds());
  }

  bindNav();
  showPanel('overview');
}

boot();
