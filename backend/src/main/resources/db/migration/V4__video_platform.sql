-- 视频监控平台配置（萤石/流媒体等全局参数，单行 JSONB）
CREATE TABLE IF NOT EXISTS cfg_video_platform (
    id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  VARCHAR(64)
);
