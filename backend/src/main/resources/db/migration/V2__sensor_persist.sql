-- 传感器推送持久化：最新值 + 事件流水

CREATE TABLE IF NOT EXISTS biz_sensor_latest (
    category     VARCHAR(32)  NOT NULL,
    sensor_key   VARCHAR(128) NOT NULL,
    source       VARCHAR(16),
    topic        VARCHAR(255),
    payload      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    received_at  TIMESTAMPTZ  NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (category, sensor_key)
);
CREATE INDEX IF NOT EXISTS idx_sensor_latest_received
    ON biz_sensor_latest (received_at DESC);

CREATE TABLE IF NOT EXISTS biz_sensor_event (
    id           BIGSERIAL PRIMARY KEY,
    category     VARCHAR(32)  NOT NULL,
    sensor_key   VARCHAR(128) NOT NULL,
    source       VARCHAR(16),
    topic        VARCHAR(255),
    payload      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    received_at  TIMESTAMPTZ  NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sensor_event_key_time
    ON biz_sensor_event (category, sensor_key, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_event_time
    ON biz_sensor_event (received_at DESC);
