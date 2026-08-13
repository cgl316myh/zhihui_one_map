-- 传感器：连接配置与业务数据拆分；监测最新值改为列式表（不再以 JSONB 整包为主存储）

CREATE TABLE IF NOT EXISTS cfg_sensor_ingest (
    id                       SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled                  BOOLEAN NOT NULL DEFAULT TRUE,
    demo_push_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    demo_push_interval_sec   INT NOT NULL DEFAULT 30,
    env_retention_months     INT NOT NULL DEFAULT 3,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by               VARCHAR(64)
);
INSERT INTO cfg_sensor_ingest (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS cfg_env_station (
    id           VARCHAR(64) PRIMARY KEY,
    name         VARCHAR(128) NOT NULL,
    location     VARCHAR(255),
    lng          DOUBLE PRECISION,
    lat          DOUBLE PRECISION,
    client_id    VARCHAR(128),
    enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    sort_no      INT NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cfg_env_station_client ON cfg_env_station (client_id);

CREATE TABLE IF NOT EXISTS cfg_slope_device (
    device_sn    VARCHAR(64) PRIMARY KEY,
    external_id  VARCHAR(64),
    name         VARCHAR(128) NOT NULL,
    device_kind  VARCHAR(32) NOT NULL,
    enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    sort_no      INT NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 传感器噪声/PM 阈值（与 cfg_env_threshold JSON 业务页区分）
CREATE TABLE IF NOT EXISTS cfg_sensor_threshold (
    id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    noise_day    DOUBLE PRECISION DEFAULT 60,
    noise_night  DOUBLE PRECISION DEFAULT 50,
    pm25         DOUBLE PRECISION DEFAULT 75,
    pm10         DOUBLE PRECISION DEFAULT 150,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO cfg_sensor_threshold (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS cfg_cloud_pull_cursor (
    id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_success_at   TIMESTAMPTZ,
    last_error        VARCHAR(512),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO cfg_cloud_pull_cursor (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS biz_env_latest (
    client_id            VARCHAR(128) PRIMARY KEY,
    station_id           VARCHAR(64),
    detected_time        TIMESTAMPTZ,
    ambient_temperature  DOUBLE PRECISION,
    ambient_humidity     DOUBLE PRECISION,
    pressure             DOUBLE PRECISION,
    wind_speed           DOUBLE PRECISION,
    wind_scale           INT,
    wind_direction       DOUBLE PRECISION,
    rainfall             DOUBLE PRECISION,
    noise                DOUBLE PRECISION,
    pm25                 DOUBLE PRECISION,
    pm10                 DOUBLE PRECISION,
    tsp                  DOUBLE PRECISION,
    rssi                 DOUBLE PRECISION,
    longitude            DOUBLE PRECISION,
    latitude             DOUBLE PRECISION,
    source               VARCHAR(32) NOT NULL,
    topic                VARCHAR(255),
    received_at          TIMESTAMPTZ NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS biz_slope_latest (
    device_sn     VARCHAR(64) PRIMARY KEY,
    collect_time  TIMESTAMPTZ,
    x_mm          DOUBLE PRECISION,
    y_mm          DOUBLE PRECISION,
    h_mm          DOUBLE PRECISION,
    device_type   VARCHAR(16),
    source        VARCHAR(32) NOT NULL,
    topic         VARCHAR(255),
    received_at   TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS biz_rain_latest (
    device_sn     VARCHAR(64) PRIMARY KEY,
    collect_time  TIMESTAMPTZ,
    rain_hour     DOUBLE PRECISION,
    rain_day      DOUBLE PRECISION,
    errcode       INT,
    dev_chx       VARCHAR(32),
    source        VARCHAR(32) NOT NULL,
    topic         VARCHAR(255),
    received_at   TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
