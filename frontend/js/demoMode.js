/**
 * 演示模式开关：纯静态部署（含 GitHub Pages）时全部走本地 mock，不依赖传感器网关。
 * 本地若要接真实 MQTT/HTTP，将 STATIC_DEMO 改为 false，并启动 sensor_bridge。
 */
export const STATIC_DEMO = true;

/** 是否像 GitHub Pages / 纯静态站点一样运行（无本机网关） */
export function isStaticHosting() {
  if (STATIC_DEMO) return true;
  const host = location.hostname || '';
  return (
    host.endsWith('github.io') ||
    host.endsWith('githubusercontent.com') ||
    location.protocol === 'file:'
  );
}
