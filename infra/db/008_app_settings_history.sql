-- app_settings 덮어쓰기 이력 — 저장 직전 버전을 보관해 실수·동시 저장으로 지워진 수기 데이터 복구용
-- KPI 집계·트리거와 무관

CREATE TABLE IF NOT EXISTS app_settings_history (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  data JSONB,
  updated_at TIMESTAMPTZ,
  replaced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_settings_history_key
  ON app_settings_history (scope, kind, id DESC);

INSERT INTO schema_migrations (version, name)
VALUES (8, '008_app_settings_history')
ON CONFLICT (version) DO NOTHING;
