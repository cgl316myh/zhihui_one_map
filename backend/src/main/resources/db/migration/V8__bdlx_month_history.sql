-- 近一个月 GNSS / 雨量时序（按设备 + 采集时间去重）

CREATE TABLE IF NOT EXISTS biz_slope_hist (
    device_sn          VARCHAR(64) NOT NULL,
    collect_time       TIMESTAMPTZ NOT NULL,
    x_mm               DOUBLE PRECISION,
    y_mm               DOUBLE PRECISION,
    h_mm               DOUBLE PRECISION,
    plane_mm           DOUBLE PRECISION,
    plane_speed        DOUBLE PRECISION,
    plane_acc          DOUBLE PRECISION,
    azimuth            DOUBLE PRECISION,
    total_projection   DOUBLE PRECISION,
    speed_x            DOUBLE PRECISION,
    speed_y            DOUBLE PRECISION,
    speed_h            DOUBLE PRECISION,
    projection_speed   DOUBLE PRECISION,
    projection_acc     DOUBLE PRECISION,
    interval_hours     DOUBLE PRECISION,
    source             VARCHAR(32),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (device_sn, collect_time)
);
CREATE INDEX IF NOT EXISTS idx_slope_hist_time ON biz_slope_hist (collect_time DESC);

CREATE TABLE IF NOT EXISTS biz_rain_hist (
    device_sn     VARCHAR(64) NOT NULL,
    collect_time  TIMESTAMPTZ NOT NULL,
    rain_hour     DOUBLE PRECISION,
    rain_day      DOUBLE PRECISION,
    source        VARCHAR(32),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (device_sn, collect_time)
);
CREATE INDEX IF NOT EXISTS idx_rain_hist_time ON biz_rain_hist (collect_time DESC);

DELETE FROM ts_env_sample a
 USING ts_env_sample b
 WHERE a.id > b.id AND a.point_id = b.point_id AND a.metric = b.metric AND a.sampled_at = b.sampled_at;
CREATE UNIQUE INDEX IF NOT EXISTS uk_ts_env_point_metric_time
    ON ts_env_sample (point_id, metric, sampled_at);
