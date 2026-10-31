/**
 * 大屏视频：海康 RTSP 经 ZLM 转 HLS 后用 hls.js 播放（浏览器不能直接播 RTSP）。
 */

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

export async function renderVideoTile(container, cam, videoPayload) {
  if (!container || !cam) return;
  const playerCfg = videoPayload?.player || {};

  if (!playerCfg.enabled || cam.enabled === false) {
    container.innerHTML = `<span>${cam.online ? '未启用' : '○ OFFLINE'}</span><p>${cam.scene || ''}</p>`;
    return;
  }

  const url = cam.hlsUrl || playerCfg.fallbackUrl;
  if (url) {
    try {
      await mountHls(container, url);
      return;
    } catch {
      container.innerHTML = '<span class="video-ph-err">HLS 加载失败</span>';
      return;
    }
  }

  container.innerHTML = `<span>待转码</span><p>海康 RTSP 需经 ZLM 转 HLS 后才能在网页播放</p>`;
}

export function destroyVideoPlayers() {
  document.querySelectorAll('#panel-video video').forEach((v) => {
    if (v._hls) {
      v._hls.destroy();
      v._hls = null;
    }
  });
}
