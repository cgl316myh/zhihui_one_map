-- 易尔/BDLX 边坡云平台：最新位移扩展字段、告警、拉取游标、时序去重

ALTER TABLE biz_slope_latest
    ADD COLUMN IF NOT EXISTS plane_mm DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS plane_speed DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS plane_acc DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS azimuth DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS total_projection DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS speed_x DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS speed_y DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS speed_h DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS projection_speed DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS projection_acc DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS interval_hours DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS online BOOLEAN,
    ADD COLUMN IF NOT EXISTS maintainer VARCHAR(128),
    ADD COLUMN IF NOT EXISTS vendor_point_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS vendor_color VARCHAR(16),
    ADD COLUMN IF NOT EXISTS alarm_text VARCHAR(512);

ALTER TABLE biz_rain_latest
    ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS online BOOLEAN,
    ADD COLUMN IF NOT EXISTS maintainer VARCHAR(128),
    ADD COLUMN IF NOT EXISTS vendor_point_id VARCHAR(64);

DELETE FROM ts_slope_sample a
 USING ts_slope_sample b
 WHERE a.id > b.id AND a.point_id = b.point_id AND a.sampled_at = b.sampled_at;
CREATE UNIQUE INDEX IF NOT EXISTS uk_ts_slope_point_time
    ON ts_slope_sample (point_id, sampled_at);

CREATE TABLE IF NOT EXISTS biz_bdlx_alarm (
    vendor_id     BIGINT PRIMARY KEY,
    point_id      VARCHAR(64),
    device_sn     VARCHAR(64),
    color         VARCHAR(16),
    level         VARCHAR(16),
    title         VARCHAR(255),
    content       TEXT,
    status        VARCHAR(64),
    alarm_time    TIMESTAMPTZ,
    raw           JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bdlx_alarm_time ON biz_bdlx_alarm (alarm_time DESC);
CREATE INDEX IF NOT EXISTS idx_bdlx_alarm_point ON biz_bdlx_alarm (point_id, alarm_time DESC);

CREATE TABLE IF NOT EXISTS cfg_bdlx_pull (
    id                 SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_success_at    TIMESTAMPTZ,
    last_error         VARCHAR(512),
    points_updated     INT NOT NULL DEFAULT 0,
    samples_upserted   INT NOT NULL DEFAULT 0,
    alarms_upserted    INT NOT NULL DEFAULT 0,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO cfg_bdlx_pull (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
