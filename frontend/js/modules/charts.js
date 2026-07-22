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
  const times = (point.series || []).map((s) =>
    (s.t || '').slice(5, 10)
  );
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
        data: (point.series || []).map((s) => s.x),
        lineStyle: { color: '#3dd6ff', width: 2 },
        itemStyle: { color: '#3dd6ff' },
      },
      {
        name: 'Y',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: (point.series || []).map((s) => s.y),
        lineStyle: { color: '#7cffb2', width: 2 },
        itemStyle: { color: '#7cffb2' },
      },
      {
        name: 'H',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: (point.series || []).map((s) => s.h),
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
}

export function renderPopupSeries(domId, point) {
  if (!point) return;
  const times = (point.series || []).map((s) => (s.t || '').slice(5, 10));
  ensureChart(domId, {
    backgroundColor: 'transparent',
    grid: { top: 20, right: 8, bottom: 20, left: 30 },
    legend: {
      data: ['X', 'Y', 'H'],
      textStyle: { color: '#334', fontSize: 10 },
      top: 0,
    },
    xAxis: { type: 'category', data: times, axisLabel: { fontSize: 9 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 9 } },
    series: [
      { name: 'X', type: 'line', data: (point.series || []).map((s) => s.x), showSymbol: false },
      { name: 'Y', type: 'line', data: (point.series || []).map((s) => s.y), showSymbol: false },
      { name: 'H', type: 'line', data: (point.series || []).map((s) => s.h), showSymbol: false },
    ],
  });
}
