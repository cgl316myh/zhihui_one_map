/**
 * 由环境 / 边坡 / 生产 / 视频 mock 状态汇聚「最近报警」列表（演示用，非真实推送）。
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatNow(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function levelRank(level) {
  if (level === 'alarm') return 0;
  if (level === 'warn') return 1;
  return 2;
}

function pushItem(items, partial) {
  items.push({
    id: partial.id,
    level: partial.level || 'info',
    module: partial.module,
    title: partial.title,
    time: partial.time || formatNow(),
    pointId: partial.pointId || '',
  });
}

/**
 * @param {{ environment?: object, slope?: object, production?: object, video?: object }} sources
 * @returns {{ updatedAt: string, items: object[], source: string }}
 */
export function buildAlertsFromMock(sources = {}) {
  const { environment, slope, production, video } = sources;
  const items = [];
  const stamp = formatNow();

  (environment?.points || []).forEach((p) => {
    if (p.status === 'warn' || p.status === 'alarm') {
      const m = p.metrics || {};
      const hint =
        m.pm10 != null
          ? `PM10 ${m.pm10}${(p.units && p.units.pm10) || ''}`
          : m.noise != null
            ? `噪声 ${m.noise}${(p.units && p.units.noise) || ''}`
            : '指标超限';
      pushItem(items, {
        id: `ENV-${p.id}`,
        level: p.status === 'alarm' ? 'alarm' : 'warn',
        module: '环境监测',
        title: `${p.name} ${hint}`,
        time: stamp,
        pointId: p.id,
      });
    }
  });

  const rain = slope?.rainfall;
  if (rain && (rain.status === 'warn' || rain.status === 'alarm')) {
    pushItem(items, {
      id: `RAIN-${rain.id || 'rain'}`,
      level: rain.status === 'alarm' ? 'alarm' : 'warn',
      module: '边坡监测',
      title: `${rain.name || '雨量'} 达${rain.status === 'alarm' ? '报警' : '预警'}（时段 ${rain.valueMm ?? '—'} mm）`,
      time: rain.updatedAt || stamp,
      pointId: rain.id || '',
    });
  }

  (slope?.points || []).forEach((p) => {
    if (p.status === 'warn' || p.status === 'alarm') {
      pushItem(items, {
        id: `SLP-${p.id}`,
        level: p.status === 'alarm' ? 'alarm' : 'warn',
        module: '边坡监测',
        title: `${p.name} 位移${p.status === 'alarm' ? '报警' : '预警'}（X ${p.x ?? '—'} / Y ${p.y ?? '—'} / H ${p.h ?? '—'} ${p.unit || 'mm'}）`,
        time: p.updatedAt || slope.updatedAt || stamp,
        pointId: p.id,
      });
    }
  });

  (production?.lines || []).forEach((line) => {
    (line.devices || []).forEach((d) => {
      if (d.status === 'warn' || d.status === 'alarm' || d.status === 'fault') {
        pushItem(items, {
          id: `PRD-${d.id}`,
          level: d.status === 'fault' || d.status === 'alarm' ? 'alarm' : 'warn',
          module: '生产监控',
          title: `${line.name} · ${d.name}${d.alarm ? '，' + d.alarm : ' 状态异常'}`,
          time: stamp,
          pointId: d.id,
        });
      }
    });
    if (
      (line.status === 'warn' || line.status === 'alarm' || line.status === 'fault') &&
      !(line.devices || []).some((d) => d.status === 'warn' || d.status === 'alarm' || d.status === 'fault')
    ) {
      pushItem(items, {
        id: `LINE-${line.id}`,
        level: line.status === 'warn' ? 'warn' : 'alarm',
        module: '生产监控',
        title: `${line.name} 工段状态：${line.status}`,
        time: stamp,
        pointId: line.id,
      });
    }
  });

  (video?.cameras || []).forEach((c) => {
    if (c.online === false) {
      pushItem(items, {
        id: `CAM-${c.id}`,
        level: 'info',
        module: '视频监控',
        title: `${c.name} 摄像头离线`,
        time: stamp,
        pointId: c.id,
      });
    }
  });

  items.sort((a, b) => {
    const lr = levelRank(a.level) - levelRank(b.level);
    if (lr !== 0) return lr;
    return String(b.time).localeCompare(String(a.time));
  });

  return {
    updatedAt: new Date().toISOString(),
    source: 'mock-aggregate',
    items,
  };
}
