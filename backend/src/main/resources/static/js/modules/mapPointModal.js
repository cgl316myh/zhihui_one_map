/**
 * 地图点位近全屏详情模态；最多 5 个最小化方块，贴在「控制和工具」右侧。
 */

const MAX_MINIMIZED = 5;

let root = null;
let titleEl = null;
let bodyEl = null;
let panelEl = null;
let dockEl = null;
let bound = false;

/** 当前全屏展示的条目（未最小化） */
let active = null;
/** @type {Array<{id:string,title:string,html:string,badge:string,onOpen?:Function,onClose?:Function}>} */
let minimizedList = [];

let seq = 0;

function ensureDom() {
  root = document.getElementById('map-point-modal');
  if (!root) return;
  titleEl = document.getElementById('map-point-modal-title');
  bodyEl = document.getElementById('map-point-modal-body');
  panelEl = root.querySelector('.map-point-modal__panel');
  dockEl = document.getElementById('map-point-modal-dock');
  syncChipSize();
  if (bound) return;
  bound = true;

  root.querySelectorAll('[data-modal-dismiss]').forEach((el) => {
    el.addEventListener('click', () => closeMapPointModal());
  });
  root.querySelectorAll('[data-modal-minimize]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      minimizeMapPointModal();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (active) closeMapPointModal();
  });
  window.addEventListener('resize', () => syncChipSize());
}

function syncChipSize() {
  const hd = document.querySelector('#tool-box .layer-box-hd');
  const h = hd ? Math.round(hd.getBoundingClientRect().height) : 38;
  document.documentElement.style.setProperty('--map-mini-chip', `${Math.max(28, h)}px`);
}

function setModalVisible(show) {
  if (!root) return;
  if (show) {
    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('map-point-modal-open');
  } else {
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('map-point-modal-open');
  }
}

function runHook(fn) {
  if (typeof fn !== 'function') return;
  try {
    fn();
  } catch (err) {
    console.warn('[map-point-modal] hook', err);
  }
}

function snapshotActive() {
  if (!active) return null;
  return {
    id: active.id,
    title: active.title,
    html: bodyEl ? bodyEl.innerHTML : active.html,
    badge: active.badge,
    onOpen: active.onOpen,
    onClose: active.onClose,
  };
}

function pushMinimized(item) {
  if (!item) return;
  minimizedList = minimizedList.filter((x) => x.id !== item.id);
  minimizedList.unshift(item);
  while (minimizedList.length > MAX_MINIMIZED) {
    const dropped = minimizedList.pop();
    runHook(dropped?.onClose);
  }
  renderDock();
}

function renderDock() {
  ensureDom();
  if (!dockEl) return;
  syncChipSize();
  if (!minimizedList.length) {
    dockEl.hidden = true;
    dockEl.setAttribute('aria-hidden', 'true');
    dockEl.innerHTML = '';
    return;
  }
  dockEl.hidden = false;
  dockEl.setAttribute('aria-hidden', 'false');
  dockEl.innerHTML = minimizedList
    .map((item, idx) => {
      const tip = escapeAttr(item.title || '点位详情');
      const badge = escapeHtml(item.badge || String(idx + 1));
      return `<button type="button" class="map-point-mini-chip" data-mini-id="${escapeAttr(item.id)}" aria-label="${tip}">
        <span class="map-point-mini-chip__badge">${badge}</span>
        <span class="map-point-mini-chip__tip" role="tooltip">${tip}</span>
      </button>`;
    })
    .join('');

  dockEl.querySelectorAll('.map-point-mini-chip').forEach((btn) => {
    btn.addEventListener('click', () => restoreMapPointModal(btn.getAttribute('data-mini-id')));
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function badgeFromTitle(title, kind) {
  if (kind) return String(kind).slice(0, 1);
  const t = String(title || '').trim();
  if (!t) return '点';
  return t.slice(0, 1);
}

/**
 * @param {{ id?: string, title?: string, html: string, badge?: string, kind?: string, onOpen?: Function, onClose?: Function }} opts
 */
export function openMapPointModal(opts) {
  ensureDom();
  if (!root || !bodyEl || !titleEl) {
    console.warn('[map-point-modal] shell missing in index.html');
    return;
  }

  // 已有全屏窗口：先收入最小化队列（满 5 个则挤掉最旧）
  if (active) {
    const snap = snapshotActive();
    runHook(active.onClose);
    active = null;
    setModalVisible(false);
    pushMinimized(snap);
  }

  const id = String(opts?.id || `modal-${++seq}`);
  // 若队列里已有同一 id，先移除（相当于提到前台）
  minimizedList = minimizedList.filter((x) => x.id !== id);
  renderDock();

  const title = opts?.title || '点位详情';
  const html = opts?.html || '';
  active = {
    id,
    title,
    html,
    badge: opts?.badge || badgeFromTitle(title, opts?.kind),
    onOpen: opts?.onOpen,
    onClose: opts?.onClose,
  };

  titleEl.textContent = title;
  bodyEl.innerHTML = html;
  if (panelEl) panelEl.classList.remove('is-minimized');
  root.classList.remove('is-minimized');
  setModalVisible(true);

  if (typeof opts?.onOpen === 'function') {
    setTimeout(() => runHook(opts.onOpen), 40);
  }
}

export function minimizeMapPointModal() {
  if (!active) return;
  ensureDom();
  const snap = snapshotActive();
  runHook(active.onClose);
  active = null;
  setModalVisible(false);
  pushMinimized(snap);
}

export function restoreMapPointModal(id) {
  ensureDom();
  const idx = minimizedList.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const item = minimizedList[idx];
  minimizedList.splice(idx, 1);
  renderDock();

  // 当前全屏先最小化
  if (active) {
    const snap = snapshotActive();
    runHook(active.onClose);
    active = null;
    setModalVisible(false);
    pushMinimized(snap);
  }

  active = { ...item };
  titleEl.textContent = item.title;
  bodyEl.innerHTML = item.html;
  setModalVisible(true);
  setTimeout(() => runHook(item.onOpen), 40);
}

/**
 * @param {{ silentUi?: boolean }} [opts]
 */
export function closeMapPointModal(opts = {}) {
  ensureDom();
  if (!active && !opts.silentUi) return;

  const hook = active?.onClose;
  active = null;
  runHook(hook);

  if (bodyEl) bodyEl.innerHTML = '';
  if (root) root.classList.remove('is-minimized');
  if (panelEl) panelEl.classList.remove('is-minimized');
  if (!opts.silentUi) setModalVisible(false);
}

export function isMapPointModalOpen() {
  return Boolean(active);
}
