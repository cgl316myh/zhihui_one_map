-- 智慧矿山一张图 · 一期初始化
-- 库：zhihui_one_map · 时区按应用 Asia/Shanghai

CREATE TABLE IF NOT EXISTS sys_user (
    id              BIGSERIAL PRIMARY KEY,
    username        VARCHAR(64)  NOT NULL UNIQUE,
    password_hash   VARCHAR(100) NOT NULL,
    display_name    VARCHAR(128),
    phone           VARCHAR(32),
    role            VARCHAR(16)  NOT NULL DEFAULT 'user',
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_sys_user_role CHECK (role IN ('admin', 'user'))
);

CREATE TABLE IF NOT EXISTS sys_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    actor       VARCHAR(64),
    action      VARCHAR(64)  NOT NULL,
    target      VARCHAR(128),
    result      VARCHAR(32)  NOT NULL DEFAULT 'ok',
    summary     TEXT,
    ip          VARCHAR(64),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON sys_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON sys_audit_log (actor);

CREATE TABLE IF NOT EXISTS sys_dict_type (
    code        VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    remark      VARCHAR(255),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_dict_item (
    id          BIGSERIAL PRIMARY KEY,
    type_code   VARCHAR(64)  NOT NULL REFERENCES sys_dict_type(code) ON DELETE CASCADE,
    item_code   VARCHAR(64)  NOT NULL,
    label       VARCHAR(128) NOT NULL,
    sort_no     INT          NOT NULL DEFAULT 0,
    enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
    UNIQUE (type_code, item_code)
);

CREATE TABLE IF NOT EXISTS cfg_env_threshold (
    id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS cfg_map (
    id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS cfg_sensor_bridge (
    id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS cfg_reserves (
    id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS biz_production (
    id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS biz_video_camera (
    id          VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    lng         DOUBLE PRECISION,
    lat         DOUBLE PRECISION,
    online      BOOLEAN NOT NULL DEFAULT FALSE,
    scene       VARCHAR(255),
    sort_no     INT NOT NULL DEFAULT 0,
    extra       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS biz_map_point (
    id          VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    type        VARCHAR(32)  NOT NULL,
    lng         DOUBLE PRECISION,
    lat         DOUBLE PRECISION,
    external_id VARCHAR(64),
    extra       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 二期预留：时序表（一期可不写）
CREATE TABLE IF NOT EXISTS ts_env_sample (
    id          BIGSERIAL PRIMARY KEY,
    point_id    VARCHAR(64) NOT NULL,
    metric      VARCHAR(64) NOT NULL,
    value       DOUBLE PRECISION,
    sampled_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ts_env_point_time ON ts_env_sample (point_id, sampled_at DESC);

CREATE TABLE IF NOT EXISTS ts_slope_sample (
    id          BIGSERIAL PRIMARY KEY,
    point_id    VARCHAR(64) NOT NULL,
    x           DOUBLE PRECISION,
    y           DOUBLE PRECISION,
    h           DOUBLE PRECISION,
    magnitude   DOUBLE PRECISION,
    sampled_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ts_slope_point_time ON ts_slope_sample (point_id, sampled_at DESC);

-- 字典种子
INSERT INTO sys_dict_type (code, name, remark) VALUES
    ('point_status', '点位状态', '大屏状态文案'),
    ('alert_level', '报警级别', NULL),
    ('user_role', '用户角色', NULL),
    ('layer_type', '图层类型', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO sys_dict_item (type_code, item_code, label, sort_no) VALUES
    ('point_status', 'normal', '正常', 1),
    ('point_status', 'warn', '预警', 2),
    ('point_status', 'alarm', '报警', 3),
    ('point_status', 'running', '运行', 4),
    ('point_status', 'fault', '故障', 5),
    ('point_status', 'offline', '离线', 6),
    ('alert_level', 'info', '提示', 1),
    ('alert_level', 'warn', '预警', 2),
    ('alert_level', 'alarm', '报警', 3),
    ('user_role', 'admin', '管理员', 1),
    ('user_role', 'user', '值班员', 2),
    ('layer_type', 'environment', '环境监测', 1),
    ('layer_type', 'slope', '边坡', 2),
    ('layer_type', 'video', '视频', 3),
    ('layer_type', 'production', '生产', 4)
ON CONFLICT (type_code, item_code) DO NOTHING;

-- 配置占位（空 JSON，应用启动时可从文件导入或后台写入）
INSERT INTO cfg_env_threshold (id, payload) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO cfg_map (id, payload) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO cfg_sensor_bridge (id, payload) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO cfg_reserves (id, payload) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO biz_production (id, payload) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;

-- 用户由 DataInitializer 用 BCrypt 写入（密码 123456），此处不硬编码哈希
