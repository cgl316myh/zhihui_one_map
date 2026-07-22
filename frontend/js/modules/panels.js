import {
  renderSlopeTrend,
  renderRainTrend,
  renderReserveCharts,
  renderEnvHistory,
} from './charts.js';
import {
  getEnvThresholds,
  getActivePeriodKey,
  getDefaultEnvThresholds,
} from './envThresholds.js';

function statusClass(status) {
  if (status === 'alarm' || status === 'fault') return 'st-alarm';
  if (status === 'warn' || status === 'offline') return 'st-warn';
  if (status === 'running') return 'st-ok';
  return 'st-ok';
}

function statusText(status) {
  const map = {
    normal: '正常',
    warn: '预警',
    alarm: '报警',
    running: '运行',
    fault: '故障',
    offline: '离线',
  };
  return map[status] || status || '—';
}

export function setEnvPollStatus(ok, message) {
  const el = document.getElementById('env-poll-status');
  if (!el) return;
  el.className = ok ? 'poll-ok' : 'poll-err';
  el.textContent = message;
}

/**
 * @param {object} env
 * @param {string|null} selectedId
 */
export function renderEnvironment(env, selectedId = null) {
  const box = document.getElementById('panel-environment');
  if (!box || !env) return null;
  const points = env.points || [];
  const focus =
    points.find((p) => p.id === selectedId) ||
    points.find((p) => p.status === 'warn' || p.status === 'alarm') ||
    points[0] ||
    null;

  const liveTag = env.live
    ? '<div class="poll-ok" style="margin-bottom:8px">实时接入 · MQTT/HTTP</div>'
    : env.source === 'fallback-mock' || env.source === 'local-mock'
      ? '<div class="poll-ok" style="margin-bottom:8px">演示 · 本地 mock</div>'
      : '';

  box.innerHTML =
    liveTag +
    points
      .map((p) => {
        const m = p.metrics || {};
        const keys = Object.keys(m);
        const rows = keys
          .map(
            (k) =>
              `<span>${metricLabel(k)} <b>${m[k]}</b>${(p.units && p.units[k]) || ''}</span>`
          )
          .join('');
        const hit = p.statusHit
          ? `<div class="metric-loc">触发 ${metricLabel(p.statusHit.key)} ≥ ${p.statusHit.limit}</div>`
          : '';
        const active = focus && p.id === focus.id ? 'active' : '';
        return `
        <button type="button" class="metric-card ${statusClass(p.status)} ${active}" data-env-id="${p.id}">
          <div class="metric-head">
            <strong>${p.name}</strong>
            <em class="${statusClass(p.status)}">${statusText(p.status)}</em>
          </div>
          <div class="metric-loc">${p.location || ''}</div>
          <div class="metric-grid">${rows || '<span>等待传感器数据…</span>'}</div>
          ${hit}
        </button>`;
      })
      .join('');

  const cap = document.getElementById('env-chart-caption');
  if (cap) {
    cap.textContent = focus
      ? `${focus.name} · 近 24h 历史（mock）`
      : '历史曲线';
  }
  if (focus) renderEnvHistory(focus);

  return focus ? focus.id : null;
}

export function renderEnvThresholdForm(thresholds, handlers = {}) {
  const box = document.getElementById('panel-env-thresholds');
  if (!box) return;
  const th = thresholds || getEnvThresholds();
  const period = getActivePeriodKey();
  const periodLabel = period === 'day' ? '当前昼间' : '当前夜间';
  const fields = [
    { key: 'noise', label: '噪声' },
    { key: 'pm10', label: 'PM10' },
    { key: 'pm25', label: 'PM2.5' },
    { key: 'dust', label: '粉尘' },
  ];

  const row = (mode, title) => `
    <div class="thresh-period ${mode === period ? 'is-active' : ''}">
      <div class="thresh-period-hd">${title}${mode === period ? ' · 生效中' : ''}</div>
      <div class="thresh-grid">
        ${fields
          .map((f) => {
            const rule = (th[mode] && th[mode][f.key]) || {};
            const unit = rule.unit || '';
            return `
            <label class="thresh-field">
              <span>${f.label}预警 ${unit}</span>
              <input type="number" step="0.1" data-mode="${mode}" data-metric="${f.key}" data-bound="warn" value="${rule.warn ?? ''}" />
            </label>
            <label class="thresh-field">
              <span>${f.label}报警 ${unit}</span>
              <input type="number" step="0.1" data-mode="${mode}" data-metric="${f.key}" data-bound="alarm" value="${rule.alarm ?? ''}" />
            </label>`;
          })
          .join('')}
      </div>
    </div>`;

  box.innerHTML = `
    <div class="thresh-hd">
      <strong>阈值配置（演示）</strong>
      <span class="sub">${periodLabel} · 仅本地存储</span>
    </div>
    ${row('day', '昼间 06–22')}
    ${row('night', '夜间 22–06')}
    <div class="thresh-actions">
      <button type="button" class="tool-btn" id="btn-thresh-save">应用阈值</button>
      <button type="button" class="tool-btn ghost" id="btn-thresh-reset">恢复默认</button>
    </div>`;

  box.querySelector('#btn-thresh-save')?.addEventListener('click', () => {
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
    handlers.onSave?.(next);
  });

  box.querySelector('#btn-thresh-reset')?.addEventListener('click', () => {
    handlers.onReset?.(getDefaultEnvThresholds());
  });
}

function metricLabel(key) {
  const map = {
    temperature: '温度',
    humidity: '湿度',
    noise: '噪声',
    pm25: 'PM2.5',
    pm10: 'PM10',
    dust: '粉尘',
  };
  return map[key] || key;
}

export function renderProduction(prod) {
  const box = document.getElementById('panel-production');
  if (!box || !prod) return;
  box.innerHTML = (prod.lines || [])
    .map((line) => {
      const devices = (line.devices || [])
        .map((d) => {
          const bits = [];
          if (d.currentA != null) bits.push(`电流 ${d.currentA}A`);
          if (d.bearingTemp != null) bits.push(`轴温 ${d.bearingTemp}℃`);
          if (d.freqHz != null) bits.push(`频率 ${d.freqHz}Hz`);
          if (d.vibrateHz != null) bits.push(`激振 ${d.vibrateHz}Hz`);
          if (d.flowTph != null) bits.push(`流量 ${d.flowTph}t/h`);
          if (d.speedRpm != null) bits.push(`转速 ${d.speedRpm}rpm`);
          const detail = bits.length ? `<div class="metric-loc">${bits.join(' · ')}</div>` : '';
          return `
          <li class="${statusClass(d.status)}">
            <span>${d.name}</span>
            <em>${statusText(d.status)}${d.alarm ? ' · ' + d.alarm : ''}</em>
            ${detail}
          </li>`;
        })
        .join('');
      return `
        <div class="prod-block">
          <div class="metric-head">
            <strong>${line.name}</strong>
            <em class="${statusClass(line.status)}">${statusText(line.status)}</em>
          </div>
          <ul class="prod-list">${devices}</ul>
        </div>`;
    })
    .join('');
}

export function renderAlerts(alerts) {
  const box = document.getElementById('panel-alerts');
  if (!box || !alerts) return;
  const items = alerts.items || [];
  box.innerHTML = items.length
    ? items
        .map(
          (a) => `
      <div class="alert-item level-${a.level}">
        <div class="alert-top">
          <span class="tag">${a.module}</span>
          <time>${a.time}</time>
        </div>
        <p>${a.title}</p>
      </div>`
        )
        .join('')
    : '<div class="metric-loc">当前无汇聚报警</div>';
}

export function renderSlopePanel(slopeData, selectedId, handlers = {}) {
  const list = document.getElementById('panel-slope-list');
  const rain = document.getElementById('panel-rainfall');
  const meta = document.getElementById('slope-updated');
  const actions = document.getElementById('panel-slope-actions');
  if (!slopeData) return;

  if (meta) {
    meta.textContent = `更新 ${formatTime(slopeData.updatedAt)}`;
  }

  if (rain && slopeData.rainfall) {
    const r = slopeData.rainfall;
    const yl24 =
      r.yl24h != null
        ? `<div><label>近24小时</label><b>${r.yl24h}</b><i>mm</i></div>`
        : '';
    rain.innerHTML = `
      <div class="rain-card ${statusClass(r.status)}">
        <div class="metric-head">
          <strong>${r.name || '雨量监测点'}</strong>
          <em class="${statusClass(r.status)}">${statusText(r.status)}</em>
        </div>
        <div class="rain-vals">
          <div><label>时段雨量</label><b>${r.valueMm}</b><i>mm</i></div>
          <div><label>区间累计</label><b>${r.cumulativeMm}</b><i>mm</i></div>
          ${yl24}
        </div>
        ${r.updatedAt ? `<div class="metric-loc">更新 ${formatTime(r.updatedAt)}</div>` : ''}
      </div>`;
    renderRainTrend(r);
  }

  const points = slopeData.points || [];
  const focus =
    points.find((p) => p.id === selectedId) ||
    points.find((p) => p.computedStatus === 'warn' || p.computedStatus === 'alarm') ||
    points.find((p) => p.status === 'warn' || p.status === 'alarm') ||
    points[0];

  if (list) {
    list.innerHTML = points
      .map((p) => {
        const active = focus && p.id === focus.id ? 'active' : '';
        const th = p.threshold || {};
        const cleared = p.cleared
          ? `<span class="cleared-tag">已消警</span>`
          : '';
        return `
        <button type="button" class="slope-item ${statusClass(p.status)} ${active}" data-slope-id="${p.id}">
          <div class="metric-head">
            <strong>${p.name}</strong>
            <em class="${statusClass(p.status)}">${statusText(p.status)}${cleared}</em>
          </div>
          <div class="xyz">
            <span>X <b>${fmtNum(p.x)}</b></span>
            <span>Y <b>${fmtNum(p.y)}</b></span>
            <span>H <b>${fmtNum(p.h)}</b></span>
            <span class="unit">${p.unit || 'mm'}</span>
          </div>
          <div class="metric-loc">幅值 ${fmtNum(p.magnitude)} · 预警 ${th.warn ?? '—'} / 报警 ${th.alarm ?? '—'}</div>
        </button>`;
      })
      .join('');
  }

  if (actions) {
    if (focus) {
      const needClear =
        !focus.cleared &&
        (focus.computedStatus === 'warn' || focus.computedStatus === 'alarm');
      const canRevoke = Boolean(focus.cleared);
      actions.innerHTML = `
        <div class="slope-actions">
          <span class="metric-loc">选中：${focus.name}</span>
          ${
            needClear
              ? `<button type="button" class="tool-btn" id="btn-slope-clear">消警（演示）</button>`
              : ''
          }
          ${
            canRevoke
              ? `<button type="button" class="tool-btn ghost" id="btn-slope-revoke">恢复预警态</button>`
              : ''
          }
          <button type="button" class="tool-btn ghost" id="btn-slope-reset-clears">清除全部消警</button>
        </div>`;
      actions.querySelector('#btn-slope-clear')?.addEventListener('click', () => {
        handlers.onClear?.(focus.id, focus.computedStatus);
      });
      actions.querySelector('#btn-slope-revoke')?.addEventListener('click', () => {
        handlers.onRevoke?.(focus.id);
      });
      actions.querySelector('#btn-slope-reset-clears')?.addEventListener('click', () => {
        handlers.onResetClears?.();
      });
    } else {
      actions.innerHTML = '';
    }
  }

  renderSlopeTrend(focus);
  return focus ? focus.id : null;
}

export function renderReserves(reserves) {
  const box = document.getElementById('panel-reserve-summary');
  if (!box || !reserves) return;
  const days = Number(reserves.remainingDays);
  const warnYears = Number(reserves.warningYears);
  const yearsLeft =
    Number.isFinite(days) && days >= 0 ? +(days / 365).toFixed(1) : null;
  const underWarn =
    yearsLeft != null && Number.isFinite(warnYears) && yearsLeft <= warnYears;
  const tip = underWarn
    ? `<div class="reserve-warn" role="status">服务年限约 <b>${yearsLeft}</b> 年，已达/低于预警阈值 <b>${warnYears}</b> 年，请关注采掘节奏与储量接续。</div>`
    : yearsLeft != null && Number.isFinite(warnYears)
      ? `<div class="reserve-ok" role="status">服务年限约 <b>${yearsLeft}</b> 年（预警阈值 ${warnYears} 年）</div>`
      : '';
  box.innerHTML = `
    ${tip}
    <div class="reserve-kpis">
      <div><label>初始保有</label><b>${reserves.initialReserve}</b><i>${reserves.unit}</i></div>
      <div><label>剩余保有</label><b>${reserves.remaining}</b><i>${reserves.unit}</i></div>
      <div><label>预计可采</label><b>${reserves.remainingDays}</b><i>天</i></div>
    </div>`;
  renderReserveCharts(reserves);
}

export function renderVideo(video) {
  const box = document.getElementById('panel-video');
  if (!box || !video) return;
  box.innerHTML = (video.cameras || [])
    .map(
      (c) => `
      <div class="video-tile ${c.online ? 'online' : 'offline'}">
        <div class="video-screen">
          <span>${c.online ? '● LIVE' : '○ OFFLINE'}</span>
          <p>${c.scene || ''}</p>
        </div>
        <div class="video-name">${c.name}</div>
      </div>`
    )
    .join('');
}

export function setSlopePollStatus(ok, message) {
  const el = document.getElementById('slope-poll-status');
  if (!el) return;
  el.className = ok ? 'poll-ok' : 'poll-err';
  el.textContent = message;
}

function fmtNum(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toFixed(2);
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).replace('T', ' ').slice(0, 19);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
