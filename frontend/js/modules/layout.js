import { invalidateMapSize } from './map.js';

const STORAGE_KEY = 'mine-one-map-layout';
const DEFAULTS = { left: 340, right: 360 };
const MIN = 220;
const MAX = 520;
const COLLAPSED = 0;

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

/**
 * 左右栏拖拽调宽 + 收起/展开
 */
export function initResizableSidebars() {
  const workspace = document.querySelector('.workspace');
  if (!workspace) return;

  const state = loadState();
  // 兼容旧值：若曾存成过小正数，拉回默认
  if (state.left > 0 && state.left < MIN) state.left = DEFAULTS.left;
  if (state.right > 0 && state.right < MIN) state.right = DEFAULTS.right;
  applyWidths(workspace, state);

  let lastExpanded = {
    left: state.left > 0 ? state.left : DEFAULTS.left,
    right: state.right > 0 ? state.right : DEFAULTS.right,
  };

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
      state[side] = next;
      lastExpanded[side] = next;
      applyWidths(workspace, state);
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('resizing-sidebars');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      saveState(state);
      invalidateMapSize();
      resizeCharts();
    };

    handle.addEventListener('pointerdown', (e) => {
      if (state[side] <= 0) return;
      dragging = true;
      startX = e.clientX;
      startW = state[side];
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
    if (state[side] <= 0) {
      state[side] = lastExpanded[side] || DEFAULTS[side];
    } else {
      lastExpanded[side] = state[side];
      state[side] = COLLAPSED;
    }
    applyWidths(workspace, state);
    saveState(state);
  };

  bindResizer('left');
  bindResizer('right');

  document.getElementById('toggle-left')?.addEventListener('click', () => toggle('left'));
  document.getElementById('toggle-right')?.addEventListener('click', () => toggle('right'));

  window.addEventListener('resize', () => invalidateMapSize());
}
