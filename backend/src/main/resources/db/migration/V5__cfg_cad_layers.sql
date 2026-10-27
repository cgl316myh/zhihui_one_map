-- CAD 矢量图层清单（管理员控制前端是否可加载）
CREATE TABLE IF NOT EXISTS cfg_cad_layers (
    id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  VARCHAR(64)
);

INSERT INTO cfg_cad_layers (id, payload) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
