-- essersales Phase 1-2 — SQLite 이전용 컬럼 보완
-- 001_initial.sql 은 수정하지 않음. 기존 DB에 ALTER 로 적용.

-- ---------------------------------------------------------------------------
-- uploads: SQLite total_count, file_type
-- ---------------------------------------------------------------------------
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS total_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT '';

-- ---------------------------------------------------------------------------
-- sales_records: 필터·KPI·인덱스용 정규 컬럼 (나머지는 data JSONB)
-- 001에 이미 있음: order_date, platform, sales_method, channel, store_name,
--   product_name, sales, sales_qty, net_profit, ad_spend, data
-- ---------------------------------------------------------------------------
ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS product_code TEXT;
ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS option_name TEXT;
ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS transaction_type TEXT;
ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS upload_kind TEXT;
ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS upload_format TEXT;
ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS period_from DATE;
ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS period_to DATE;
ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS business_date DATE;

CREATE INDEX IF NOT EXISTS idx_sales_records_upload_kind
  ON sales_records (upload_kind);

CREATE INDEX IF NOT EXISTS idx_sales_records_transaction_type
  ON sales_records (transaction_type);

CREATE INDEX IF NOT EXISTS idx_sales_records_upload_format
  ON sales_records (upload_format);

CREATE INDEX IF NOT EXISTS idx_sales_records_product_code
  ON sales_records (product_code);

-- ---------------------------------------------------------------------------
-- migration marker
-- ---------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES (2, '002_sqlite_migration_columns')
ON CONFLICT (version) DO NOTHING;
