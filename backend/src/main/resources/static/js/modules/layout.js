import { invalidateMapSize } from './map.js';

const STORAGE_KEY = 'mine-one-map-layout';
const DEFAULTS = { left: 340, right: 360 };
const MIN = 220;
const MAX = 520;
const COLLAPSED = 0;

/** @type {HTMLElement|null} */
let workspaceEl = null;
/** @type {{ left: number, right: number }|null} */
let layoutState = null;
/** @type {{ left: number, right: number }|null} */
let lastExpanded = null;

const PANEL_SIDE = {
  'sec-map': 'center',
  'sec-env': 'left',
  'sec-prod': 'left',
  'sec-slope': 'right',
  'sec-reserve': 'right',
  'sec-video': 'right',
};

function resizeCharts() {
  window.dispatchEvent(new Event('resize'));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      left: Number.isFinite(parsed.left) ? parsed.left : DEFAULTS.left,
      right: Number.isFinite(parsed.right) ? parsed.right : DEFAULTS.right,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function applyWidths(workspace, state) {
  workspace.style.setProperty('--left-w', `${state.left}px`);
  workspace.style.setProperty('--right-w', `${state.right}px`);
  workspace.classList.toggle('left-collapsed', state.left <= 0);
  workspace.classList.toggle('right-collapsed', state.right <= 0);

  const leftBtn = document.getElementById('toggle-left');
  const rightBtn = document.getElementById('toggle-right');
  if (leftBtn) {
    leftBtn.setAttribute('aria-pressed', state.left <= 0 ? 'true' : 'false');
    leftBtn.title = state.left <= 0 ? '展开左侧栏' : '收起左侧栏';
    leftBtn.textContent = state.left <= 0 ? '⟩' : '⟨';
  }
  if (rightBtn) {
    rightBtn.setAttribute('aria-pressed', state.right <= 0 ? 'true' : 'false');
    rightBtn.title = state.right <= 0 ? '展开右侧栏' : '收起右侧栏';
    rightBtn.textContent = state.right <= 0 ? '⟨' : '⟩';
  }

  requestAnimationFrame(() => {
    invalidateMapSize();
    resizeCharts();
  });
}

export function isSidebarCollapsed(side) {
  return !layoutState || layoutState[side] <= 0;
}

/** @returns {boolean} 是否刚执行了展开 */
export function expandSidebar(side) {
  if (!workspaceEl || !layoutState || !lastExpanded) return false;
  if (side !== 'left' && side !== 'right') return false;
  if (layoutState[side] > 0) return false;
  layoutState[side] = lastExpanded[side] || DEFAULTS[side];
  applyWidths(workspaceEl, layoutState);
  saveState(layoutState);
  return true;
}

function isPanelInView(el) {
  if (!el) return false;
  const col = el.closest('.column');
  if (!col) {
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 40;
  }
  if (col.classList.contains('left-col') && isSidebarCollapsed('left')) return false;
  if (col.classList.contains('right-col') && isSidebarCollapsed('right')) return false;
  const cr = col.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  if (cr.width < 8) return false;
  const visibleTop = Math.max(er.top, cr.top);
  const visibleBottom = Math.min(er.bottom, cr.bottom);
  return visibleBottom - visibleTop >= Math.min(48, er.height * 0.35);
}

/**
 * 顶部菜单定位：收起则展开对应侧栏并滚到模块；已在视野内则标记 alreadyVisible。
 * @returns {{ expanded: boolean, alreadyVisible: boolean, side: string }}
 */
export function focusWorkspacePanel(sectionId) {
  const side = PANEL_SIDE[sectionId] || 'center';
  const el = document.getElementById(sectionId);
  const alreadyVisible = isPanelInView(el);
  let expanded = false;

  if ((side === 'left' || side === 'right') && isSidebarCollapsed(side)) {
    expanded = expandSidebar(side);
  }

  const scrollToPanel = () => {
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (side === 'center') {
      invalidateMapSize();
    } else {
      resizeCharts();
    }
  };

  if (expanded) {
    requestAnimationFrame(() => {
      setTimeout(scrollToPanel, 100);
    });
  } else if (!alreadyVisible) {
    scrollToPanel();
  } else if (side === 'center') {
    invalidateMapSize();
  }

  return { expanded, alreadyVisible: alreadyVisible && !expanded, side };
}

/**
 * 左右栏拖拽调宽 + 收起/展开
 */
export function initResizableSidebars() {
  const workspace = document.querySelector('.workspace');
  if (!workspace) return;

  workspaceEl = workspace;
  layoutState = loadState();
  if (layoutState.left > 0 && layoutState.left < MIN) layoutState.left = DEFAULTS.left;
  if (layoutState.right > 0 && layoutState.right < MIN) layoutState.right = DEFAULTS.right;
  lastExpanded = {
    left: layoutState.left > 0 ? layoutState.left : DEFAULTS.left,
    right: layoutState.right > 0 ? layoutState.right : DEFAULTS.right,
  };
  applyWidths(workspace, layoutState);

  const bindResizer = (side) => {
    const handle = document.querySelector(`.resizer[data-side="${side}"]`);
    if (!handle) return;

    let dragging = false;
    let startX = 0;
    let startW = 0;

    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      let next;
      if (side === 'left') {
        next = clamp(startW + dx, MIN, MAX);
      } else {
        next = clamp(startW - dx, MIN, MAX);
      }
      layoutState[side] = next;
      lastExpanded[side] = next;
      applyWidths(workspace, layoutState);
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('resizing-sidebars');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      saveState(layoutState);
      invalidateMapSize();
      resizeCharts();
    };

    handle.addEventListener('pointerdown', (e) => {
      if (layoutState[side] <= 0) return;
      dragging = true;
      startX = e.clientX;
      startW = layoutState[side];
      document.body.classList.add('resizing-sidebars');
      handle.setPointerCapture?.(e.pointerId);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      e.preventDefault();
    });

    handle.addEventListener('dblclick', () => {
      toggle(side);
    });
  };

  const toggle = (side) => {
    if (layoutState[side] <= 0) {
      layoutState[side] = lastExpanded[side] || DEFAULTS[side];
    } else {
      lastExpanded[side] = layoutState[side];
      layoutState[side] = COLLAPSED;
    }
    applyWidths(workspace, layoutState);
    saveState(layoutState);
  };

  bindResizer('left');
  bindResizer('right');

  document.getElementById('toggle-left')?.addEventListener('click', () => toggle('left'));
  document.getElementById('toggle-right')?.addEventListener('click', () => toggle('right'));

  window.addEventListener('resize', () => invalidateMapSize());
}
