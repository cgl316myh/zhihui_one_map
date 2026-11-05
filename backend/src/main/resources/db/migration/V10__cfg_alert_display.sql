-- 大屏是否显示报警（全局开关，默认关闭=不报警）
CREATE TABLE IF NOT EXISTS cfg_alert_display (
    id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    payload     JSONB NOT NULL DEFAULT '{"enabled": false}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  VARCHAR(64)
);

INSERT INTO cfg_alert_display (id, payload)
VALUES (1, '{"enabled": false}'::jsonb)
ON CONFLICT (id) DO NOTHING;
