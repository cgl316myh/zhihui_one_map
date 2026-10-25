/**
 * 大屏数据：仅走 Spring /api/*（库表 + 传感器桥接），禁止回退本地演示 JSON。
 */

import { apiGet } from './client.js';
import { isStaticHosting } from '../demoMode.js';

async function unwrap(path) {
  const r = await apiGet(path);
  if (!r.ok) {
    throw new Error(r.message || `${path} 请求失败`);
  }
  return r.data;
}

export async function loadDashboardBundle() {
  if (isStaticHosting()) {
    throw new Error('当前为静态托管环境，未连接后端，拒绝加载演示数据');
  }

  const [environment, production, video, reserves, alerts, mapPoints, publicCfg] =
    await Promise.all([
      unwrap('/api/environment'),
      unwrap('/api/production'),
      unwrap('/api/video'),
      unwrap('/api/reserves'),
      unwrap('/api/alerts'),
      unwrap('/api/map-points'),
      unwrap('/api/config/public'),
    ]);

  const slopePoints = {
    mapCenter: mapPoints?.mapCenter || publicCfg?.mapCenter || null,
    mapZoom: mapPoints?.mapZoom ?? publicCfg?.mapZoom ?? 15,
    project: mapPoints?.project || publicCfg?.project || '',
    points: Array.isArray(mapPoints?.points) ? mapPoints.points : [],
    source: mapPoints?.source || 'database',
  };

  return {
    environment: environment || { live: false, points: [], source: 'bridge-unavailable' },
    production: production || {},
    video: video || { cameras: [] },
    reserves: reserves || {},
    alerts: Array.isArray(alerts) ? { items: alerts } : alerts || { items: [] },
    slopePoints,
    envThresholds: publicCfg?.envThresholds || null,
    publicConfig: publicCfg || {},
  };
}
