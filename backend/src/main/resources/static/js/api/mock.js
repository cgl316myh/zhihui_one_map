const DATA_BASE = './data';

async function loadJson(name) {
  const res = await fetch(`${DATA_BASE}/${name}?_=${Date.now()}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`加载 ${name} 失败: HTTP ${res.status}`);
  return res.json();
}

/**
 * 一次性加载非边坡类本地测试数据
 */
export async function loadMockBundle() {
  const [environment, production, video, reserves, alerts, slopePoints, envThresholds] =
    await Promise.all([
      loadJson('environment.json'),
      loadJson('production.json'),
      loadJson('video.json'),
      loadJson('reserves.json'),
      loadJson('alerts.json'),
      loadJson('slope-points.json'),
      loadJson('env-thresholds.json').catch(() => null),
    ]);

  return {
    environment,
    production,
    video,
    reserves,
    alerts,
    slopePoints,
    envThresholds,
  };
}
