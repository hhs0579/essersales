-- essersales Phase 0 — initial schema
-- Applied automatically on first PostgreSQL container start (docker-entrypoint-initdb.d)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- uploads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  storage_path TEXT,
  platform TEXT DEFAULT '',
  sales_method TEXT DEFAULT '',
  upload_kind TEXT NOT NULL DEFAULT 'sales_report',
  business_date DATE,
  period_from DATE,
  period_to DATE,
  detail_count INTEGER NOT NULL DEFAULT 0,
  daily_count INTEGER NOT NULL DEFAULT 0,
  channel_count INTEGER NOT NULL DEFAULT 0,
  product_count INTEGER NOT NULL DEFAULT 0,
  product_option_count INTEGER NOT NULL DEFAULT 0,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  parse_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uploads_kind_created ON uploads (upload_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploads_platform_business_date ON uploads (platform, business_date);

-- ---------------------------------------------------------------------------
-- upload_files
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS upload_files (
  upload_id UUID PRIMARY KEY REFERENCES uploads (id) ON DELETE CASCADE,
  sha256 TEXT,
  size_bytes BIGINT,
  mime_type TEXT,
  stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- sales_records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
  record_type TEXT NOT NULL,
  order_date DATE,
  platform TEXT,
  sales_method TEXT,
  channel TEXT,
  store_name TEXT,
  product_name TEXT,
  sales NUMERIC(18, 2),
  sales_qty NUMERIC(18, 4),
  net_profit NUMERIC(18, 2),
  ad_spend NUMERIC(18, 2),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_records_type_order_date ON sales_records (record_type, order_date);
CREATE INDEX IF NOT EXISTS idx_sales_records_upload_id ON sales_records (upload_id);
CREATE INDEX IF NOT EXISTS idx_sales_records_platform_method_date
  ON sales_records (platform, sales_method, order_date);

-- ---------------------------------------------------------------------------
-- app_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, kind)
);

-- ---------------------------------------------------------------------------
-- export_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  file_path TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_status_created ON export_jobs (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- migration marker
-- ---------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES (1, '001_initial')
ON CONFLICT (version) DO NOTHING;
