-- 环境云平台（ThingsBoard / 182.40.193.119）登录与拉取游标

CREATE TABLE IF NOT EXISTS cfg_ft_env_pull (
    id                 INT PRIMARY KEY DEFAULT 1,
    enabled            BOOLEAN NOT NULL DEFAULT TRUE,
    web_url            VARCHAR(255),
    api_base           VARCHAR(255),
    username           VARCHAR(128),
    password           VARCHAR(256),
    cron               VARCHAR(64),
    lookback_hours     INT,
    last_success_at    TIMESTAMPTZ,
    last_error         TEXT,
    points_updated     INT,
    samples_upserted   INT,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cfg_ft_env_pull_one CHECK (id = 1)
);

INSERT INTO cfg_ft_env_pull (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
