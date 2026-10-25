/**
 * 大屏视频播放：根据 /api/video 返回的 player + cameras 初始化 EZUIKit 或 HLS。
 */

const ezPlayers = new Map();
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

function loadEzUIKit() {
  if (window.EZUIKit?.EZUIKitPlayer || window.EZUIKitPlayer) {
    return Promise.resolve();
  }
  return loadScript('vendor/ezuikit/ezuikit.js');
}

function getEzPlayerClass() {
  if (window.EZUIKit?.EZUIKitPlayer) return window.EZUIKit.EZUIKitPlayer;
  if (window.EZUIKitPlayer) return window.EZUIKitPlayer;
  return null;
}

function destroyAll() {
  ezPlayers.forEach((p) => {
    try { p.destroy?.(); } catch (_) { /* ignore */ }
  });
  ezPlayers.clear();
}

async function mountHls(container, url) {
  container.innerHTML = '<video playsinline muted controls style="width:100%;height:100%;object-fit:contain;background:#000"></video>';
  const video = container.querySelector('video');
  const Hls = await loadHls();
  if (Hls?.isSupported()) {
    const hls = new Hls({ liveSyncDuration: 3 });
    hls.loadSource(url);
    hls.attachMedia(video);
    video._hls = hls;
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
  }
  video.play().catch(() => {});
}

async function mountEzviz(container, cam, playerCfg) {
  await loadEzUIKit();
  const PlayerClass = getEzPlayerClass();
  if (!PlayerClass || !playerCfg.accessToken || !cam.playUrl) {
    container.innerHTML = '<span class="video-ph-err">萤石参数未就绪</span>';
    return;
  }
  container.innerHTML = '';
  const hostId = `ez-${cam.id}`;
  const host = document.createElement('div');
  host.id = hostId;
  host.style.width = '100%';
  host.style.height = '100%';
  container.appendChild(host);
  const inst = new PlayerClass({
    id: hostId,
    accessToken: playerCfg.accessToken,
    url: cam.playUrl,
    template: playerCfg.template || 'simple',
    width: container.clientWidth || 360,
    height: container.clientHeight || 200,
    scaleMode: 1,
    staticPath: playerCfg.staticPath || undefined,
    env: { domain: playerCfg.domain || 'https://open.ys7.com' },
  });
  ezPlayers.set(cam.id, inst);
}

export async function renderVideoTile(container, cam, videoPayload) {
  if (!container || !cam) return;
  const playerCfg = videoPayload?.player || {};
  const provider = cam.provider || playerCfg.provider || 'ezviz';

  if (!playerCfg.enabled || cam.enabled === false) {
    container.innerHTML = `<span>${cam.online ? '未启用' : '○ OFFLINE'}</span><p>${cam.scene || ''}</p>`;
    return;
  }

  if (provider === 'hls' || cam.hlsUrl) {
    const url = cam.hlsUrl || playerCfg.fallbackUrl;
    if (url) {
      try {
        await mountHls(container, url);
        return;
      } catch (e) {
        container.innerHTML = `<span class="video-ph-err">HLS 加载失败</span>`;
        return;
      }
    }
  }

  if (provider === 'ezviz' && cam.playUrl && playerCfg.accessToken) {
    try {
      await mountEzviz(container, cam, playerCfg);
      return;
    } catch (e) {
      container.innerHTML = `<span class="video-ph-err">萤石播放失败</span>`;
      return;
    }
  }

  container.innerHTML = `<span>${cam.online ? '● LIVE' : '○ OFFLINE'}</span><p>${cam.scene || ''}</p>`;
}

export function destroyVideoPlayers() {
  destroyAll();
  document.querySelectorAll('#panel-video video').forEach((v) => {
    if (v._hls) {
      v._hls.destroy();
      v._hls = null;
    }
  });
}
