/**
 * 大屏视频：默认不拉流；点击「播放」后按需启动 HLS（经后端 FFmpeg 转 H.264）。
 */

import { apiPost } from '../api/client.js';

let hlsLibPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('脚本加载失败: ' + src));
    document.head.appendChild(s);
  });
}

function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLibPromise) {
    hlsLibPromise = loadScript('vendor/hls.js/hls.min.js').then(() => window.Hls);
  }
  return hlsLibPromise;
}

function destroyMedia(container) {
  if (!container) return;
  const video = container.querySelector('video');
  if (video?._hls) {
    try {
      video._hls.destroy();
    } catch {
      /* ignore */
    }
    video._hls = null;
  }
  if (video) {
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {
      /* ignore */
    }
  }
}

async function mountHls(container, url) {
  destroyMedia(container);
  container.innerHTML =
    '<video playsinline muted controls style="width:100%;height:100%;object-fit:contain;background:#000"></video>';
  const video = container.querySelector('video');
  const Hls = await loadHls();
  if (Hls?.isSupported()) {
    const hls = new Hls({ liveSyncDuration: 3, enableWorker: true });
    hls.loadSource(url);
    hls.attachMedia(video);
    video._hls = hls;
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
  }
  video.play().catch(() => {});
}

function idleHtml(cam, tip) {
  const online = cam.online !== false;
  const title = tip || (online ? '点击播放' : '离线');
  return `
    <div class="video-idle">
      <button type="button" class="video-play-btn" ${online ? '' : 'disabled'}>▶ ${title}</button>
      <p class="video-idle-sub">${cam.scene || cam.host || ''}</p>
    </div>`;
}

function busyHtml(text) {
  return `<div class="video-idle"><span class="video-busy">${text}</span></div>`;
}

/**
 * @param {HTMLElement} container
 * @param {object} cam
 * @param {object} videoPayload
 * @param {{ autoStart?: boolean }} [opts]
 */
export async function renderVideoTile(container, cam, videoPayload, opts = {}) {
  if (!container || !cam) return;
  destroyMedia(container);
  container.dataset.camId = cam.id || '';
  container._videoCam = cam;
  container._videoPayload = videoPayload;

  const playerCfg = videoPayload?.player || {};
  if (!playerCfg.enabled || cam.enabled === false) {
    container.innerHTML = `<span>${cam.online ? '未启用' : '○ OFFLINE'}</span><p>${cam.scene || ''}</p>`;
    return;
  }

  if (!cam.canPlay && !cam.hlsUrl && !cam.zlmStream) {
    container.innerHTML = `<span>待配置</span><p>缺少流地址</p>`;
    return;
  }

  const start = async () => {
    container.innerHTML = busyHtml('启动转码…');
    let url = cam.hlsUrl;
    try {
      const r = await apiPost(`/api/video/${encodeURIComponent(cam.id)}/play`, {});
      if (r.ok && r.data?.hlsUrl) {
        url = r.data.hlsUrl;
        cam.hlsUrl = url;
        container._streamActive = true;
      } else if (!url) {
        throw new Error(r.message || '启动失败');
      }
    } catch (e) {
      // 后端未就绪时仍尝试已有 hlsUrl
      if (!url) {
        container._streamActive = false;
        container.innerHTML = idleHtml(cam, '启动失败');
        container.querySelector('.video-play-btn')?.addEventListener('click', start);
        const sub = container.querySelector('.video-idle-sub');
        if (sub) sub.textContent = e.message || '请稍后重试';
        return;
      }
    }

    container.innerHTML = busyHtml('加载画面…');
    try {
      await mountHls(container, url);
      const bar = document.createElement('div');
      bar.className = 'video-toolbar';
      bar.innerHTML = '<button type="button" class="video-stop-btn">停止</button>';
      container.appendChild(bar);
      bar.querySelector('.video-stop-btn')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await stopVideoPlayback(container);
      });
    } catch {
      // 转码可能已在后端启动，保留 _streamActive，下次销毁/停止时回收
      container.innerHTML = idleHtml(cam, '播放失败');
      container.querySelector('.video-play-btn')?.addEventListener('click', start);
    }
  };

  if (opts.autoStart) {
    await start();
    return;
  }

  container.innerHTML = idleHtml(cam);
  container.querySelector('.video-play-btn')?.addEventListener('click', start);
}

export async function stopVideoPlayback(container) {
  if (!container) return;
  const cam = container._videoCam;
  const payload = container._videoPayload;
  const camId = cam?.id || container.dataset.camId;
  const shouldStop = container._streamActive || !!container.querySelector('video');
  destroyMedia(container);
  container._streamActive = false;
  if (shouldStop && camId) {
    try {
      await apiPost(`/api/video/${encodeURIComponent(camId)}/stop`, {});
    } catch {
      /* ignore */
    }
  }
  // 弹窗关闭后节点可能已移除，不再回写空闲态
  if (cam && document.body.contains(container)) {
    await renderVideoTile(container, cam, payload || {}, { autoStart: false });
  }
}

/**
 * 销毁指定根节点下的播放器（侧栏重绘 / 弹窗）。
 * 对已启动转码的路数异步调用 /stop，避免 FFmpeg 残留。
 */
export function destroyVideoPlayers(rootSelector = '#panel-video') {
  const toStop = [];
  document.querySelectorAll(`${rootSelector} .video-screen, ${rootSelector} .popup-video-mount`).forEach((el) => {
    const camId = el._videoCam?.id || el.dataset.camId;
    const active = !!el._streamActive || !!el.querySelector('video');
    destroyMedia(el);
    el._streamActive = false;
    if (active && camId) {
      toStop.push(camId);
    }
  });
  toStop.forEach((id) => {
    apiPost(`/api/video/${encodeURIComponent(id)}/stop`, {}).catch(() => {});
  });
}
