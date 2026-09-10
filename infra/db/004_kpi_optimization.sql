ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS kpi_date DATE;
ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS kpi_aggregation_date DATE;

-- Initial backfill for existing rows
UPDATE sales_records SET
  kpi_date = COALESCE(
    order_date,
    business_date,
    period_from,
    CASE
      WHEN data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        THEN (SUBSTRING(data->>'date' FROM 1 FOR 10))::date
      ELSE NULL
    END
  ),
  kpi_aggregation_date = COALESCE(
    CASE
      WHEN data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        THEN (SUBSTRING(data->>'date' FROM 1 FOR 10))::date
      WHEN data->>'contextDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        THEN (SUBSTRING(data->>'contextDate' FROM 1 FOR 10))::date
      ELSE NULL
    END,
    business_date,
    CASE
      WHEN period_from IS NOT NULL AND (period_to IS NULL OR period_from = period_to)
        THEN period_from
      ELSE NULL
    END
  );

CREATE OR REPLACE FUNCTION sales_records_compute_kpi_dates()
RETURNS TRIGGER AS $$
BEGIN
  NEW.kpi_date = COALESCE(
    NEW.order_date,
    NEW.business_date,
    NEW.period_from,
    CASE
      WHEN NEW.data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        THEN (SUBSTRING(NEW.data->>'date' FROM 1 FOR 10))::date
      ELSE NULL
    END
  );

  NEW.kpi_aggregation_date = COALESCE(
    CASE
      WHEN NEW.data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        THEN (SUBSTRING(NEW.data->>'date' FROM 1 FOR 10))::date
      WHEN NEW.data->>'contextDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        THEN (SUBSTRING(NEW.data->>'contextDate' FROM 1 FOR 10))::date
      ELSE NULL
    END,
    NEW.business_date,
    CASE
      WHEN NEW.period_from IS NOT NULL AND (NEW.period_to IS NULL OR NEW.period_from = NEW.period_to)
        THEN NEW.period_from
      ELSE NULL
    END
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_records_kpi_dates ON sales_records;
CREATE TRIGGER trg_sales_records_kpi_dates
BEFORE INSERT OR UPDATE ON sales_records
FOR EACH ROW
EXECUTE PROCEDURE sales_records_compute_kpi_dates();

-- Create indexes for the dashboard queries
CREATE INDEX IF NOT EXISTS idx_sales_kpi_date ON sales_records (kpi_date, platform, sales_method);
CREATE INDEX IF NOT EXISTS idx_sales_kpi_agg_date ON sales_records (kpi_aggregation_date, platform, sales_method);
CREATE INDEX IF NOT EXISTS idx_sales_upload_kind ON sales_records (upload_kind);

INSERT INTO schema_migrations (version, name)
VALUES (4, '004_kpi_optimization')
ON CONFLICT (version) DO NOTHING;
