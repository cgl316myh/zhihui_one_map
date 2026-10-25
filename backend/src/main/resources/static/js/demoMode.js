/**
 * 运行模式：
 * - 业务数据一律走后端 API / 数据库，禁止回退演示 JSON。
 * - isStaticHosting() 仅用于识别无后端环境（禁加载业务数据），不再自动灌入 mock。
 */
export const STATIC_DEMO = false;

/** 是否像 GitHub Pages / 纯静态站点一样运行（无本机后端） */
export function isStaticHosting() {
  if (STATIC_DEMO) return true;
  const host = location.hostname || '';
  return (
    host.endsWith('github.io') ||
    host.endsWith('githubusercontent.com') ||
    location.protocol === 'file:'
  );
}
