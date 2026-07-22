const chartRegistry = new Map();

function ensureChart(domId, option) {
  const el = document.getElementById(domId);
  if (!el || typeof echarts === 'undefined') return null;

  let chart = chartRegistry.get(domId);
  if (!chart) {
    chart = echarts.init(el);
    chartRegistry.set(domId, chart);
    window.addEventListener('resize', () => chart.resize());
  }
  chart.setOption(option, true);
  return chart;
}

const axisStyle = {
  axisLabel: { color: 'rgba(200,220,255,0.75)', fontSize: 10 },
  axisLine: { lineStyle: { color: 'rgba(80,140,220,0.35)' } },
  splitLine: { lineStyle: { color: 'rgba(80,140,220,0.12)' } },
};

/** 雨量独立趋势：取近期点，过密时抽样，避免折线糊成一团 */
export function renderRainTrend(rainfall) {
  if (!rainfall) return;
  const raw = Array.isArray(rainfall.series) ? rainfall.series : [];
  const maxPts = 48;
  const step = raw.length > maxPts ? Math.ceil(raw.length / maxPts) : 1;
  const series = raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
  const times = series.map((s) => (s.t || '').slice(5, 16));
  ensureChart('chart-rain-trend', {
    backgroundColor: 'transparent',
    grid: { top: 28, right: 12, bottom: 22, left: 40 },
    legend: {
      data: ['时段雨量'],
      textStyle: { color: 'rgba(200,220,255,0.8)', fontSize: 10 },
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 6,
    },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: times, ...axisStyle },
    yAxis: {
      type: 'value',
      name: 'mm',
      nameTextStyle: { color: 'rgba(200,220,255,0.55)', fontSize: 10 },
      ...axisStyle,
    },
    series: [
      {
        name: '时段雨量',
        type: 'line',
        smooth: true,
        showSymbol: false,
        areaStyle: { color: 'rgba(61,214,255,0.12)' },
        data: series.map((s) => s.value),
        lineStyle: { color: '#3dd6ff', width: 2 },
        itemStyle: { color: '#3dd6ff' },
      },
    ],
  });
}

export function renderSlopeTrend(point) {
  if (!point) return;
  const maxPts = 24;
  const series = Array.isArray(point.series) ? point.series : [];
  const short = series.length > maxPts ? series.slice(-maxPts) : series;
  const times = short.map((s) => (s.t || '').slice(5, 16));
  ensureChart('chart-slope-trend', {
    backgroundColor: 'transparent',
    grid: { top: 28, right: 12, bottom: 22, left: 36 },
    legend: {
      data: ['X', 'Y', 'H'],
      textStyle: { color: 'rgba(200,220,255,0.8)', fontSize: 10 },
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 6,
    },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: times, ...axisStyle },
    yAxis: {
      type: 'value',
      name: 'mm',
      nameTextStyle: { color: 'rgba(200,220,255,0.55)', fontSize: 10 },
      ...axisStyle,
    },
    series: [
      {
        name: 'X',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: short.map((s) => s.x),
        lineStyle: { color: '#3dd6ff', width: 2 },
        itemStyle: { color: '#3dd6ff' },
      },
      {
        name: 'Y',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: short.map((s) => s.y),
        lineStyle: { color: '#7cffb2', width: 2 },
        itemStyle: { color: '#7cffb2' },
      },
      {
        name: 'H',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: short.map((s) => s.h),
        lineStyle: { color: '#ffc857', width: 2 },
        itemStyle: { color: '#ffc857' },
      },
    ],
  });
}

export function renderReserveCharts(reserves) {
  if (!reserves) return;

  ensureChart('chart-reserve-pie', {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '52%'],
        label: {
          color: 'rgba(220,235,255,0.9)',
          fontSize: 10,
          formatter: '{b}\n{c}',
        },
        data: [
          { name: '已开采', value: reserves.mined, itemStyle: { color: '#3d7eff' } },
          { name: '剩余保有', value: reserves.remaining, itemStyle: { color: '#2ee6a6' } },
          {
            name: '设计可采差',
            value: Math.max(0, +(reserves.designRecoverable - reserves.remaining).toFixed(1)),
            itemStyle: { color: '#5a6d8c' },
          },
        ],
      },
    ],
  });

  const hist = reserves.trend || [];
  const forecast = reserves.forecast || [];
  ensureChart('chart-reserve-trend', {
    backgroundColor: 'transparent',
    grid: { top: 24, right: 10, bottom: 22, left: 40 },
    tooltip: { trigger: 'axis' },
    legend: {
      data: ['实际', '预测'],
      textStyle: { color: 'rgba(200,220,255,0.8)', fontSize: 10 },
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 6,
    },
    xAxis: {
      type: 'category',
      data: [...hist.map((i) => i.month.slice(5)), ...forecast.map((i) => i.month.slice(5))],
      ...axisStyle,
    },
    yAxis: {
      type: 'value',
      name: '万吨',
      nameTextStyle: { color: 'rgba(200,220,255,0.55)', fontSize: 10 },
      ...axisStyle,
    },
    series: [
      {
        name: '实际',
        type: 'line',
        smooth: true,
        data: [...hist.map((i) => i.remaining), ...forecast.map(() => null)],
        lineStyle: { color: '#3dd6ff', width: 2 },
        itemStyle: { color: '#3dd6ff' },
        showSymbol: false,
      },
      {
        name: '预测',
        type: 'line',
        smooth: true,
        data: [
          ...hist.slice(0, -1).map(() => null),
          hist.length ? hist[hist.length - 1].remaining : null,
          ...forecast.map((i) => i.remaining),
        ],
        lineStyle: { color: '#ffc857', width: 2, type: 'dashed' },
        itemStyle: { color: '#ffc857' },
        showSymbol: false,
      },
    ],
  });

  renderReserveCalendar(reserves);
}

/** 日采出日历热力（ECharts calendar） */
export function renderReserveCalendar(reserves) {
  const el = document.getElementById('chart-reserve-calendar');
  if (!el || typeof echarts === 'undefined') return;
  const daily = Array.isArray(reserves?.daily) ? reserves.daily : [];
  const unit = reserves?.unit || '万吨';
  const data = daily.map((d) => [d.date, Number(d.mined) || 0]);
  let range = ['2026-07-01', '2026-07-31'];
  if (data.length) {
    const dates = data.map((d) => d[0]).sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    const [y, m] = last.split('-').map(Number);
    const endDay = new Date(y, m, 0).getDate();
    const end = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    range = [`${first.slice(0, 7)}-01`, end];
  }
  const maxV = data.reduce((m, d) => Math.max(m, d[1]), 0.01);
  ensureChart('chart-reserve-calendar', {
    backgroundColor: 'transparent',
    tooltip: {
      formatter: (p) => {
        const v = Array.isArray(p.data) ? p.data[1] : p.value;
        const day = Array.isArray(p.data) ? p.data[0] : p.value?.[0];
        return `${day}<br/>日采出 <b>${v}</b> ${unit}`;
      },
    },
    visualMap: {
      min: 0,
      max: maxV,
      orient: 'horizontal',
      left: 'center',
      bottom: 2,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: 'rgba(200,220,255,0.75)', fontSize: 10 },
      inRange: { color: ['#0b2a40', '#1a6b8a', '#3dd6ff', '#ffc857'] },
    },
    calendar: {
      top: 36,
      left: 28,
      right: 8,
      bottom: 28,
      cellSize: ['auto', 16],
      range,
      itemStyle: { borderWidth: 0.5, borderColor: 'rgba(80,140,220,0.25)' },
      yearLabel: { show: false },
      monthLabel: { color: 'rgba(200,220,255,0.7)', fontSize: 10 },
      dayLabel: { color: 'rgba(200,220,255,0.55)', fontSize: 9, nameMap: 'cn' },
      splitLine: { lineStyle: { color: 'rgba(80,140,220,0.25)' } },
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data,
      },
    ],
  });
}

export function renderPopupSeries(domId, point, options = {}) {
  if (!point) return;
  const maxPts = options.maxPts || 12;
  const series = Array.isArray(point.series) ? point.series : [];
  const short = series.length > maxPts ? series.slice(-maxPts) : series;
  const times = short.map((s) => (s.t || '').slice(5, 16));
  ensureChart(domId, {
    backgroundColor: 'transparent',
    grid: { top: 22, right: 8, bottom: 22, left: 32 },
    legend: {
      data: ['X', 'Y', 'H'],
      textStyle: { color: '#456', fontSize: 10 },
      top: 0,
      itemWidth: 8,
      itemHeight: 6,
    },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: times,
      axisLabel: { fontSize: 9, color: '#567' },
      axisLine: { lineStyle: { color: '#bcd' } },
    },
    yAxis: {
      type: 'value',
      name: 'mm',
      nameTextStyle: { fontSize: 9, color: '#678' },
      axisLabel: { fontSize: 9, color: '#567' },
      splitLine: { lineStyle: { color: '#e4eaf2' } },
    },
    series: [
      {
        name: 'X',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: short.map((s) => s.x),
        lineStyle: { color: '#2a8fd6', width: 2 },
      },
      {
        name: 'Y',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: short.map((s) => s.y),
        lineStyle: { color: '#2e9b6a', width: 2 },
      },
      {
        name: 'H',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: short.map((s) => s.h),
        lineStyle: { color: '#c48a1a', width: 2 },
      },
    ],
  });
}

const ENV_METRIC_COLORS = {
  noise: '#3dd6ff',
  pm10: '#ffc857',
  pm25: '#ff8f6b',
  dust: '#b48cff',
  temperature: '#7cffb2',
  humidity: '#6aa8ff',
};

/** 环境点历史折线（mock history） */
export function renderEnvHistory(point, preferredKeys) {
  if (!point) return;
  const hist = Array.isArray(point.history) ? point.history : [];
  const keys =
    preferredKeys && preferredKeys.length
      ? preferredKeys.filter((k) => hist.some((h) => h[k] != null))
      : ['noise', 'pm10', 'pm25', 'dust'].filter((k) => hist.some((h) => h[k] != null));
  const times = hist.map((h) => h.t || '');
  ensureChart('chart-env-history', {
    backgroundColor: 'transparent',
    grid: { top: 28, right: 10, bottom: 22, left: 36 },
    legend: {
      data: keys.map((k) => metricName(k)),
      textStyle: { color: 'rgba(200,220,255,0.8)', fontSize: 10 },
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 6,
    },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: times, ...axisStyle },
    yAxis: { type: 'value', ...axisStyle },
    series: keys.map((k) => ({
      name: metricName(k),
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: hist.map((h) => h[k]),
      lineStyle: { color: ENV_METRIC_COLORS[k] || '#3dd6ff', width: 2 },
      itemStyle: { color: ENV_METRIC_COLORS[k] || '#3dd6ff' },
    })),
  });
}

function metricName(key) {
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

export function renderPopupEnvHistory(domId, point) {
  if (!point) return;
  const hist = Array.isArray(point.history) ? point.history : [];
  const keys = ['noise', 'pm10', 'pm25', 'dust'].filter((k) =>
    hist.some((h) => h[k] != null)
  );
  ensureChart(domId, {
    backgroundColor: 'transparent',
    grid: { top: 22, right: 8, bottom: 22, left: 32 },
    legend: {
      data: keys.map((k) => metricName(k)),
      textStyle: { color: '#456', fontSize: 9 },
      top: 0,
      itemWidth: 8,
      itemHeight: 6,
    },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: hist.map((h) => h.t || ''),
      axisLabel: { fontSize: 8, color: '#567' },
    },
    yAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#567' } },
    series: keys.map((k) => ({
      name: metricName(k),
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: hist.map((h) => h[k]),
      lineStyle: { width: 1.5 },
    })),
  });
}
