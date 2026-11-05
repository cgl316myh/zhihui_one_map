/**
 * 大屏报警显示开关（与后台 cfg_alert_display 同步）。
 * 默认关闭（不报警）。enabled=true 时才显示预警/报警。
 */

let _enabled = false;

export function isAlertsEnabled() {
  return _enabled === true;
}

export function initAlertsEnabled(flag) {
  _enabled = flag === true;
  return isAlertsEnabled();
}

export function setAlertsEnabledLocal(flag) {
  _enabled = flag === true;
  return isAlertsEnabled();
}

/** 关闭显示时压平环境点状态 */
export function muteEnvironmentIfNeeded(env) {
  if (isAlertsEnabled() || !env) return env;
  return {
    ...env,
    points: (env.points || []).map((p) => ({
      ...p,
      status: 'normal',
    })),
  };
}

/** 关闭显示时压平边坡点 / 雨量，并清空厂商告警 */
export function muteSlopeIfNeeded(slope) {
  if (isAlertsEnabled() || !slope) return slope;
  return {
    ...slope,
    alarms: [],
    rainfall: slope.rainfall
      ? { ...slope.rainfall, status: 'normal' }
      : slope.rainfall,
    points: (slope.points || []).map((p) => ({
      ...p,
      status: 'normal',
      computedStatus: 'normal',
      cleared: false,
    })),
  };
}
